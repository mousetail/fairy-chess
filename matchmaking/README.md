# Fairy Chess matchmaking server

The online half of [fairy-chess.com](https://fairy-chess.com): it pairs players
up, decides the settings for their game, lays out the starting position, and
referees the moves. It runs on [Deno](https://deno.com) and is meant to be
served from its own host, `fairy-chess-matchmaking.mousetail.nl`.

The server reuses the game rules in `../src`, so it lays out and referees a game
with exactly the same code the board uses in the browser. Deno reads the
TypeScript sources directly, so there is nothing to build and no second copy of
the rules to keep in step.

A game outlives the connection that started it. While it is being played it is
kept in Redis under its UUID, which also names it in the address bar, so a
player who reloads the page — or a server that restarts — can pick the game back
up. Who players are, and the games they have finished, are kept in PostgreSQL;
nobody's rating is ever sent to a client.

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

| Variable               | Default   | Read by  | Meaning                                                                                                                                                                                                                                 |
| ---------------------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | `8000`    | server   | Port to listen on.                                                                                                                                                                                                                      |
| `HOST`                 | `0.0.0.0` | server   | Address to bind.                                                                                                                                                                                                                        |
| `ALLOWED_ORIGINS`      | _(empty)_ | server   | Comma-separated origins allowed to open a socket, e.g. `https://fairy-chess.com,https://www.fairy-chess.com`. An empty value allows every origin and logs a warning.                                                                    |
| `HEARTBEAT_MS`         | `30000`   | server   | How often a keepalive is sent, in milliseconds. Zero disables them.                                                                                                                                                                     |
| `MAX_MESSAGE_BYTES`    | `8192`    | server   | The largest message accepted from a client, in UTF-16 code units.                                                                                                                                                                       |
| `REDIS_URL`            | _(unset)_ | server   | Address of the Redis server holding the games in progress, e.g. `redis://localhost:6379`. Unset keeps the games in memory, as they were before there was somewhere to keep them.                                                        |
| `DATABASE_URL`         | _(unset)_ | server   | Address of the PostgreSQL database holding players and finished games, e.g. `postgres://user:password@localhost:5432/fairy_chess`. Unset keeps them in memory.                                                                          |
| `VITE_MATCHMAKING_URL` | _(unset)_ | the site | The server the browser should connect to. Each deployment states its own in its `.env`: `ws://localhost:8000/ws` for a checkout, the host's `wss://` address in production. A build made without one offers no online play and says so. |

`.env.example` is the template; copy it to `.env` and edit. Anything already in
the real environment takes precedence over the file, so a service manager can
override a single value without touching it. `deno task test` does not read the
file — the tests pass their settings in directly.

## Deploying

The waiting room lives in the process's memory, so **the server must run as a
single instance**: two instances would hold two separate queues and could never
pair their players with each other. The games themselves do not: they are kept
in Redis, so a server that restarts finds them again. Without `REDIS_URL` the
games are kept in memory too, and a restart drops them.

Point `REDIS_URL` at a Redis server and `DATABASE_URL` at a PostgreSQL database
to have games, players and their ratings outlive the process. Both are optional
— a deployment that names neither still serves games — but a server that cannot
reach a configured store logs the failure and carries on without it rather than
refusing to start.

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

That environment file needs `REDIS_URL` and `DATABASE_URL` added to it as well
as the settings above, for instance `REDIS_URL=redis://localhost:6379` and
`DATABASE_URL=postgres://fairy-chess:password@localhost/fairy_chess`. The tables
the server needs are created on startup, so an empty database is enough.

WebSockets are not subject to CORS, so the only thing left to configure on a
public host is `ALLOWED_ORIGINS`. Listing the origins that may play stops other
websites from opening sockets in a visitor's browser; a request without an
`Origin` header is accepted either way, since it cannot come from someone else's
page. During development that means listing both the live site and the Vite dev
server, e.g. `ALLOWED_ORIGINS=https://fairy-chess.com,http://localhost:5173`.

The site itself needs to be told where this server is, and each deployment says
it in its own `.env`: `VITE_MATCHMAKING_URL=ws://localhost:8000/ws` for a
checkout, and the host's `wss://` address in production. The live site is built
by `.github/workflows/pages.yml`, which passes the `VITE_MATCHMAKING_URL`
repository secret to the build, so moving a deployment to a different server is
a change of secret; a build made without one offers no online play and says so.

## How players are matched

The setting a player picks on the home screen is the _chaos level_: an index
into `chaosLevels` in `../src/replacement-rules.ts`, from `0` (normal chess) to
`4` (full random asymmetric). The server calls this the game's **complexity**.

A player is willing to play a game one level either side of the one they asked
for, so two players are paired when their requests are at most two levels apart.
The game is played at a level both of them accept: when their requests are two
apart that is the level in between, and when they are one apart either request
will do, so a coin decides between them rather than favouring the more cautious
player. Asking for "one fairy piece" and being matched against someone who asked
for level 3 therefore plays at level 2, "several fairy pieces", while a match
against someone one level away plays at whichever of the two the coin picks.

The clock works the same way. A player also picks a **time control** — an index
into `timeControls` in `../src/online/time-controls.ts`, shown as `1+2`, `3+2`,
`5+5` or `10+10` — and accepts a game one control either side of it. Two players
up to two controls apart are paired at a control both accept, so a clock can be
a step quicker or slower than the one you asked for.

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

## Games that outlive a connection

Every game is given a UUID when it starts, and the browser puts it in the
address bar as `#/game/<uuid>`. Reloading that page asks the server for the seat
back, so a player who accidentally closes the tab, or whose connection drops,
returns to the position they were looking at. The same UUID is the key the game
is stored under while it is running.

Each browser also makes itself an identifier the first time it plays online and
keeps it in local storage under `fairy-chess.playerId`. It is sent with a `join`
and echoed back in `matched`, which is what a seat is held for: a `rejoin` names
the game and the player, and is only granted when that player holds a seat at
it. An identifier is never sent to the other player — only the name is.

A game is **not** lost when its player disconnects. The seat is left empty for
them to come back to, and the clock runs on without them — including for a
player who disconnects before making their free first move, whose free move is
over the moment they go. A player who never comes back therefore loses on time,
exactly as one who simply stops moving does. Their opponent is told with
`opponentAway`, and told `opponentBack` when they return. While the page is
still open, a socket that drops tries to reconnect on its own and take the seat
back; the board says so, and only gives up after several attempts.

While a game is running it is kept in Redis, written afresh after every move and
every draw offer, so a server that restarts finds its games where they were,
with the clocks still running. When a game finishes it is removed from Redis and
written to PostgreSQL instead, with the moves as a PGN, the position the game
started from as a FEN, and the alias map that names the pieces in both. A chaos
layout is laid out at random, so the starting position cannot be worked out from
the game's settings, and a board has more piece types than the alphabet has free
letters, so the symbols they were written with have to be kept beside them.
**Nothing that is stored is sent back to a client**: the finished-game log is
not shown anywhere yet.

Players are stored in PostgreSQL too, and both ratings are moved by the result
of each finished game — a plain ELO, 1200 to start with, a win against an equal
worth 16 points. A draw counts half, a win over a stronger player is worth more,
and a game that decided nothing moves neither rating. **Ratings are never sent
to a client**: they are followed quietly so games can be paired by them later.

## Protocol

Every frame is a JSON object with a `type`. The server sends a `welcome` as soon
as the socket opens; it carries the protocol version and the levels and clocks
this server knows about, so a client can adapt rather than guess.

### Client → server

| Message       | Fields                                                                            | Meaning                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `join`        | `complexity: number`, `timeControl: number`, `name?: string`, `playerId?: string` | Ask to be matched. Re-sending it while waiting updates the preference without losing your place. `playerId` is the identifier this browser plays under; one is made for it when it sends none. |
| `rejoin`      | `gameId: string`, `playerId: string`                                              | Take back the seat held for `playerId` at the game named by `gameId`. Answered with `resumed`, or an `error` when the game has finished or the identifier holds no seat in it.                 |
| `cancelQueue` | —                                                                                 | Leave the queue. Answered with `queueCancelled`.                                                                                                                                               |
| `move`        | `pieceId: number`, `from: {x, y}`, `to: {x, y}`, `promotion?: string`             | Ask to play a move. `promotion` is a piece type key from the registry in `../src/pieces/piece_types`.                                                                                          |
| `resign`      | —                                                                                 | End the game in your opponent's favour.                                                                                                                                                        |
| `abort`       | —                                                                                 | Call the game off. Only allowed before you have moved; ends it with no result.                                                                                                                 |
| `offerDraw`   | —                                                                                 | Offer a draw, or accept the one the opponent offered. A move clears the offers.                                                                                                                |
| `cancelDraw`  | —                                                                                 | Take back a draw offer you made. A move clears the offers anyway.                                                                                                                              |
| `pong`        | —                                                                                 | Answers the server's keepalive.                                                                                                                                                                |

Squares are zero-based board coordinates, matching `Tile` in
`../src/chess-tile.ts`: `a1` is `{x: 0, y: 0}` and `h8` is `{x: 7, y: 7}`.

### Server → client

| Message          | Fields                                                                                                                                      | Meaning                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `welcome`        | `protocolVersion`, `minComplexity`, `maxComplexity`, `complexityLabels: string[]`, `timeControlLabels: string[]`                            | Sent once on connection.                                                                                                                                                                                                                        |
| `queued`         | `complexity`, `timeControl`, `waiting`                                                                                                      | You are in the queue, and this many players are in it.                                                                                                                                                                                          |
| `queueCancelled` | —                                                                                                                                           | You left the queue.                                                                                                                                                                                                                             |
| `matched`        | `gameId`, `playerId`, `color`, `opponentName`, `complexity`, `complexityLabel`, `timeControl`, `board`                                      | A game has started. `gameId` is the game's UUID; `playerId` is this client's own identifier, which it should keep. `board` is the starting position the server laid out; `timeControl` carries `index`, `label`, `initialMs` and `incrementMs`. |
| `resumed`        | `gameId`, `playerId`, `color`, `playerName`, `opponentName`, `complexity`, `complexityLabel`, `timeControl`, `board`, `clock`, `drawOffers` | A seat was taken back at a game already running. `board` is the position now, `clock` is what each clock has left now, and `drawOffers` names any side whose offer still stands.                                                                |
| `moved`          | `color`, `move`, `pgn`, `board`, `inCheck`                                                                                                  | A move was accepted and applied. `board` is the position after it; `inCheck` says whether the side that must move next is in check.                                                                                                             |
| `clock`          | `white`, `black`, `running`                                                                                                                 | What each clock has left in milliseconds, and whose is running (`"white"`, `"black"` or `null`). Sent after every move and again while a clock runs.                                                                                            |
| `moveRejected`   | `rejection`                                                                                                                                 | Your move was refused; see the reasons below.                                                                                                                                                                                                   |
| `drawOffered`    | `color`                                                                                                                                     | Someone offered a draw. Sent to both players, naming the side that offered. It stands until a move is played or the offerer takes it back.                                                                                                      |
| `drawCancelled`  | `color`                                                                                                                                     | Someone took their draw offer back. Sent to both players, naming the side that did.                                                                                                                                                             |
| `gameOver`       | `status`, `winner`                                                                                                                          | The game ended: `checkmate`, `stalemate`, `repetition`, `resign`, `draw`, `timeout` or `abort`, and who won (`"white"`, `"black"`, `"draw"`, or `null` for an abort).                                                                           |
| `opponentAway`   | `color`                                                                                                                                     | The opponent's connection dropped. The game is not over: their clock runs on, and they can take the seat back.                                                                                                                                  |
| `opponentBack`   | `color`                                                                                                                                     | The opponent took their seat back and is playing again.                                                                                                                                                                                         |
| `error`          | `message`                                                                                                                                   | A message could not be understood, or arrived at the wrong moment. The socket stays open.                                                                                                                                                       |
| `ping`           | —                                                                                                                                           | Keepalive; answer with `pong`.                                                                                                                                                                                                                  |

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
{"type":"join","complexity":2,"timeControl":1,"name":"Ada","playerId":"9f1c…"}
// server, to each player
{"type":"matched","gameId":"8b0e2f5a-0f0e-4a4e-9d5e-2f1f0a7c3b9d","playerId":"9f1c…",
 "color":"white","opponentName":"Bob",
 "complexity":2,"complexityLabel":"several fairy pieces",
 "timeControl":{"index":1,"label":"3+2","initialMs":180000,"incrementMs":2000},
 "board":{"pieces":[…],"turn":"white","halfTurnNumber":0,"symbols":{…}}}
// the player with the white pieces
{"type":"move","pieceId":4,"from":{"x":4,"y":1},"to":{"x":4,"y":3}}
// server, to both players
{"type":"moved","color":"white","move":{…},"pgn":"e4","board":{…},"inCheck":false}
{"type":"clock","white":182000,"black":180000,"running":null}
// a page reloaded on #/game/8b0e2f5a-… asks for the seat back
{"type":"rejoin","gameId":"8b0e2f5a-0f0e-4a4e-9d5e-2f1f0a7c3b9d","playerId":"9f1c…"}
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

| File                 | Role                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `protocol.ts`        | The message types, shared with this server, and `parseServerMessage` for reading an untrusted frame.                                                   |
| `serialization.ts`   | Converts a board or a move to and from JSON.                                                                                                           |
| `time-controls.ts`   | The clocks a game can be played at, shared with this server.                                                                                           |
| `client.ts`          | The socket: queues what is sent before it opens, answers keepalives, reports what arrives.                                                             |
| `session.ts`         | The connection and the state of the search, held by the app rather than by any one screen. Also takes a seat back after a reload or a lost connection. |
| `player-identity.ts` | The identifier this browser plays under, made once and kept in local storage.                                                                          |
| `game-link.ts`       | Reads and writes the game's UUID in the address bar's hash, which is how a reload finds the game.                                                      |
| `config.ts`          | Reads `VITE_MATCHMAKING_URL`; a build made without one has no server to talk to.                                                                       |

`../src/app.ts` owns the screen on show and the session, so a player who is
waiting for an opponent keeps browsing their discoveries instead of sitting on a
waiting page; the board appears whenever the opponent does, and is put back when
a game named in the address bar is rejoined. The home screen's settings,
including the name a player goes by online, are kept in local storage by
`../src/settings.ts`; the player's identifier is kept by `player-identity.ts`,
and the game's own name lives in the URL rather than in storage, so a link can
be shared and a reload comes back to the same game.

## Tests

`deno task test` covers the matching policy, the referee, the clocks, the lobby,
the stored games and the rating arithmetic, the serialisation and the message
parser, and finishes with clients playing real games over real WebSockets —
including one whose socket drops and is taken back over a new one. The tests
that open sockets bind to `127.0.0.1` on a port the operating system picks, so
they need `--allow-net`.

The Redis and PostgreSQL stores have tests of their own, against the servers
they are meant for. They are skipped unless `REDIS_URL` and `DATABASE_URL` are
set, so the ordinary run needs neither server; `docker-compose.yml` beside this
file brings up a throwaway pair for them:

```sh
docker compose up -d
REDIS_URL=redis://127.0.0.1:56379 \
DATABASE_URL=postgres://fairy:fairy@127.0.0.1:55432/fairy_chess \
  deno task test
docker compose down
```

With both set, the suite also plays a game, restarts the server over the same
stores, and rejoins the game to carry it on. The lobby's own tests use an
in-memory stand-in, so they need no server at all.

If your machine routes traffic through a proxy (`HTTP_PROXY` and friends) and
does not exempt localhost, set `NO_PROXY=127.0.0.1,localhost` for the test run.

The browser half is tested by the repository's `npm test`, which covers the
message parser, the socket's behaviour against a stand-in, the session that owns
the search and takes seats back, the stored settings, the player identifier, the
game link, and the URL fallback.

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
