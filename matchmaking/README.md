# Fairy Chess matchmaking server

The online half of [fairy-chess.com](https://fairy-chess.com): it pairs players
up, decides the settings for their game, lays out the starting position, and
referees the moves. It runs on [Deno](https://deno.com) and is meant to be
served from its own host, `fairy-chess-matchmaking.mousetail.nl`.

The server reuses the game rules in `../src`, so it lays out and referees a game
with exactly the same code the board uses in the browser. Deno reads the
TypeScript sources directly, so there is nothing to build and no second copy of
the rules to keep in step.

## Running it

```sh
cd matchmaking
deno task start        # deno run --env-file=../.env --allow-net --allow-env main.ts
deno task dev          # the same, restarting on every edit
deno task test         # deno test --allow-net
```

Clients connect to `ws://localhost:8000/ws`. `GET /` reports whether the server
is up, how many players are waiting and how many games are running.

## Configuration

Every setting comes from the environment, and `deno task` loads a `.env` file
into it first. That file sits at the top of the repository rather than beside
this server, because the site is configured from it as well: everything a
deployment has to decide lives in one place, however much of the project reads
it.

| Variable               | Default   | Read by  | Meaning                                                                                                                                                              |
| ---------------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | `8000`    | server   | Port to listen on.                                                                                                                                                   |
| `HOST`                 | `0.0.0.0` | server   | Address to bind.                                                                                                                                                     |
| `ALLOWED_ORIGINS`      | _(empty)_ | server   | Comma-separated origins allowed to open a socket, e.g. `https://fairy-chess.com,https://www.fairy-chess.com`. An empty value allows every origin and logs a warning. |
| `HEARTBEAT_MS`         | `30000`   | server   | How often a keepalive is sent, in milliseconds. Zero disables them.                                                                                                  |
| `MAX_MESSAGE_BYTES`    | `8192`    | server   | The largest message accepted from a client, in UTF-16 code units.                                                                                                    |
| `VITE_MATCHMAKING_URL` | _(unset)_ | the site | The server the browser should connect to. Unset, a development build uses `ws://localhost:8000/ws` and a production build the live host.                             |

`.env.example` is the template; copy it to `.env` and edit. Anything already in
the real environment takes precedence over the file, so a service manager can
override a single value without touching it. `deno task test` does not read the
file — the tests pass their settings in directly.

## Deploying

The lobby lives in the process's memory, so **the server must run as a single
instance**: two instances would hold two separate queues and could never pair
their players with each other. Restarting it drops every game in progress.

Put it behind a proxy that terminates TLS, so browsers can use `wss://`. With
Caddy the whole configuration is:

```
fairy-chess-matchmaking.mousetail.nl {
	reverse_proxy 127.0.0.1:8000
}
```

Caddy upgrades WebSockets and renews certificates without further help. A
systemd unit for the server itself:

```ini
[Unit]
Description=Fairy Chess matchmaking server
After=network.target

[Service]
WorkingDirectory=/srv/fairy-chess/matchmaking
ExecStart=/usr/bin/deno run --env-file=../.env --allow-net --allow-env main.ts
EnvironmentFile=/srv/fairy-chess/.env
Restart=always
User=fairy-chess

[Install]
WantedBy=multi-user.target
```

WebSockets are not subject to CORS, so the only thing left to configure on a
public host is `ALLOWED_ORIGINS`. Listing the origins that may play stops other
websites from opening sockets in a visitor's browser; a request without an
`Origin` header is accepted either way, since it cannot come from someone else's
page. During development that means listing both the live site and the Vite dev
server, e.g. `ALLOWED_ORIGINS=https://fairy-chess.com,http://localhost:5173`.

The site itself needs to be told where this server is: set
`VITE_MATCHMAKING_URL=wss://fairy-chess-matchmaking.mousetail.nl/ws` in the
build environment, or leave it unset to accept the default above.

## How players are matched

The setting a player picks on the home screen is the _chaos level_: an index
into `chaosLevels` in `../src/replacement-rules.ts`, from `0` (normal chess) to
`4` (full random asymmetric). The server calls this the game's **complexity**.

A player is paired with anyone whose preference is within one level of their
own. When two players are paired, the game is played at the level both of them
accept that is nearest to what they asked for jointly, and a tie goes to the
less chaotic level — so asking for "one fairy piece" and being matched against
someone who asked for "several fairy pieces" plays at "one fairy piece".

The clock is not negotiable the same way. A player also picks a **time control**
— an index into `timeControls` in `../src/online/time-controls.ts`, shown as
`1+2`, `3+2`, `5+5` or `10+10` — and two players are only paired when they asked
for the same one. A clock is either the one you wanted or it is not, so there is
nothing to average.

Waiting players are paired in the order they arrived, so someone who has been
waiting a long time is served before a later arrival who would fit equally well.
A player who asks to play again while already queued only updates their
preference, keeping their place.

## Clocks

A time control is the time each player starts with, plus the time added to their
clock after every move they make. The server owns the clocks, exactly as it owns
the board: it decides when one runs, and a client that has fallen behind is
corrected by the next `clock` message.

**A player's first move is free.** A clock only runs for a side that has already
moved, so someone who is still reading the pieces is not punished for it. White
moves, black moves, and from then on the clock runs for whoever is to move, the
way a chess clock does. The increment is added to a player's clock as soon as
their move is accepted.

A player whose clock reaches zero has **one second of grace** before they are
late, so a move that was in flight when the clock ran out — or a browser whose
clock drifts — is still played. Past that the game is lost on time, with
`gameOver` carrying `status: "timeout"`.

Before a player has moved, giving up is not a resignation: the board offers an
**abort** instead, which calls the game off with no result (`status: "abort"`,
`winner: null`) and credits neither side with anything. Once a player has moved,
the button is a resign again, and the server refuses an `abort` from a side that
has already moved.

## Protocol

Every frame is a JSON object with a `type`. The server sends a `welcome` as soon
as the socket opens; it carries the protocol version and the levels and clocks
this server knows about, so a client can adapt rather than guess.

### Client → server

| Message       | Fields                                                                | Meaning                                                                                               |
| ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `join`        | `complexity: number`, `timeControl: number`, `name?: string`          | Ask to be matched. Re-sending it while waiting updates the preference without losing your place.      |
| `cancelQueue` | —                                                                     | Leave the queue. Answered with `queueCancelled`.                                                      |
| `move`        | `pieceId: number`, `from: {x, y}`, `to: {x, y}`, `promotion?: string` | Ask to play a move. `promotion` is a piece type key from the registry in `../src/pieces/piece_types`. |
| `resign`      | —                                                                     | End the game in your opponent's favour.                                                               |
| `abort`       | —                                                                     | Call the game off. Only allowed before you have moved; ends it with no result.                        |
| `offerDraw`   | —                                                                     | Offer a draw, or accept the one the opponent offered. A move clears the offers.                       |
| `pong`        | —                                                                     | Answers the server's keepalive.                                                                       |

Squares are zero-based board coordinates, matching `Tile` in
`../src/chess-tile.ts`: `a1` is `{x: 0, y: 0}` and `h8` is `{x: 7, y: 7}`.

### Server → client

| Message          | Fields                                                                                                           | Meaning                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `welcome`        | `protocolVersion`, `minComplexity`, `maxComplexity`, `complexityLabels: string[]`, `timeControlLabels: string[]` | Sent once on connection.                                                                                                                                              |
| `queued`         | `complexity`, `timeControl`, `waiting`                                                                           | You are in the queue, and this many players are in it.                                                                                                                |
| `queueCancelled` | —                                                                                                                | You left the queue.                                                                                                                                                   |
| `matched`        | `gameId`, `color`, `opponentName`, `complexity`, `complexityLabel`, `timeControl`, `board`                       | A game has started. `board` is the starting position the server laid out; `timeControl` carries `index`, `label`, `initialMs` and `incrementMs`.                      |
| `moved`          | `color`, `move`, `pgn`, `board`, `inCheck`                                                                       | A move was accepted and applied. `board` is the position after it; `inCheck` says whether the side that must move next is in check.                                   |
| `clock`          | `white`, `black`, `running`                                                                                      | What each clock has left in milliseconds, and whose is running (`"white"`, `"black"` or `null`). Sent after every move and again while a clock runs.                  |
| `moveRejected`   | `rejection`                                                                                                      | Your move was refused; see the reasons below.                                                                                                                         |
| `drawOffered`    | `color`                                                                                                          | Someone offered a draw. Sent to both players, naming the side that offered. It stands until a move is played.                                                         |
| `gameOver`       | `status`, `winner`                                                                                               | The game ended: `checkmate`, `stalemate`, `repetition`, `resign`, `draw`, `timeout` or `abort`, and who won (`"white"`, `"black"`, `"draw"`, or `null` for an abort). |
| `opponentLeft`   | `winner`                                                                                                         | Your opponent's connection dropped, so you win.                                                                                                                       |
| `error`          | `message`                                                                                                        | A message could not be understood, or arrived at the wrong moment. The socket stays open.                                                                             |
| `ping`           | —                                                                                                                | Keepalive; answer with `pong`.                                                                                                                                        |

A `moveRejected` carries one of `game-over`, `not-your-turn`, `unknown-piece`,
`not-your-piece`, `stale-position`, `illegal-move`, or `promotion-required`
(with `options`, the piece type keys the move may promote to). The last one
exists so a client that does not know the promotion rules can ask the player and
try again.

A draw is agreed rather than asked for: the game is drawn as soon as both
players have offered one, and there is no way to decline, so a player who does
not want a draw simply does not offer one. Both players are told who offered, so
the one that did can tell its own offer from the opponent's.

An offer only stands until a move is played: a move clears both sides' offers,
because a position that has moved on is a new question. Clients do the same when
the `moved` message reaches them, so both ends agree on which offers are live
without another message between them.

The other draw is not offered at all: the rules the server referees by end a
game in which the same position comes round for the third time, and `ChessGame`
reports it as `repetition` just as it reports a mate or a stalemate. A local
game in the browser ends the same way, since both play by the same rules.

### A short game

```json
// both clients
{"type":"join","complexity":2,"timeControl":1,"name":"Ada"}
// server, to each player
{"type":"matched","gameId":"game-1","color":"white","opponentName":"Bob",
 "complexity":2,"complexityLabel":"several fairy pieces",
 "timeControl":{"index":1,"label":"3+2","initialMs":180000,"incrementMs":2000},
 "board":{"pieces":[…],"turn":"white","halfTurnNumber":0,"symbols":{…}}}
// the player with the white pieces
{"type":"move","pieceId":4,"from":{"x":4,"y":1},"to":{"x":4,"y":3}}
// server, to both players
{"type":"moved","color":"white","move":{…},"pgn":"e4","board":{…},"inCheck":false}
{"type":"clock","white":182000,"black":180000,"running":null}
```

## What the server decides, and what the client does

The server is the authority. It picks the chaos level and the clock, generates
the position with `ChessGame.defaultLayout`, and will only relay a move that
matches one its own `getValidMoves` produces for the piece, on the board it is
holding.

Clients still need the rules code: it is what lets the board highlight legal
destinations and open the promotion dialogue without a round trip. A move a
client computes is a _request_; the board it renders afterwards is always the
one in the last `moved` message. `../src/online/serialization.ts` converts a
board either way, and `../src/online/protocol.ts` holds the message types, so
the browser and the server cannot drift apart.

On the browser side, `../src/online/` holds the pieces that speak this protocol:

| File               | Role                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `protocol.ts`      | The message types, shared with this server, and `parseServerMessage` for reading an untrusted frame. |
| `serialization.ts` | Converts a board or a move to and from JSON.                                                         |
| `time-controls.ts` | The clocks a game can be played at, shared with this server.                                         |
| `client.ts`        | The socket: queues what is sent before it opens, answers keepalives, reports what arrives.           |
| `session.ts`       | The connection and the state of the search, held by the app rather than by any one screen.           |
| `config.ts`        | Reads `VITE_MATCHMAKING_URL` and falls back to the known deployments.                                |

`../src/app.ts` owns the screen on show and the session, so a player who is
waiting for an opponent keeps browsing their discoveries instead of sitting on a
waiting page; the board appears whenever the opponent does. The home screen's
settings, including the name a player goes by online, are kept in local storage
by `../src/settings.ts`.

## Tests

`deno task test` covers the matching policy, the referee, the clocks, the lobby,
the serialisation and the message parser, and finishes with two clients playing
a real game over real WebSockets. The tests that open sockets bind to
`127.0.0.1` on a port the operating system picks, so they need `--allow-net`.

If your machine routes traffic through a proxy (`HTTP_PROXY` and friends) and
does not exempt localhost, set `NO_PROXY=127.0.0.1,localhost` for the test run.

The browser half is tested by the repository's `npm test`, which covers the
message parser, the socket's behaviour against a stand-in, the session that owns
the search, the stored settings, and the URL fallback.

## Type checking

Deno carries the type definitions of the runtime it is about to run, so
`deno task check` needs no configuration and is the check that matters.

`tsconfig.json` beside this file describes the same program to `tsc`, which is
what an editor uses, and pulls in `@types/deno` from the repository's
`devDependencies` to do it. Deno ignores that file in favour of the
`compilerOptions` in `deno.json` — the two do not merge, and Deno's own
definitions would not be reachable from a `tsconfig.json` anyway. That is why
`deno.json` carries an explicit `strict`, which is also Deno's default: it
states the strictness rather than silently inheriting it from the environment.

`deno-globals.d.ts` holds the handful of declarations `@types/deno` leaves to
other libraries, currently just `import.meta.main`.
