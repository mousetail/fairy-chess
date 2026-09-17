import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type GameListener,
  MatchmakingSession,
  type MatchmakingStatus,
  type OnlineGame,
  type ReviewedGame,
} from "../src/online/session.ts";
import {
  PROTOCOL_VERSION,
  type ServerMessage,
} from "../src/online/protocol.ts";
import type { SerializedBoardState } from "../src/online/serialization.ts";
import { FakeSocket } from "./fake-socket.ts";

/** A session over sockets the test drives, and everything it has reported. */
function sessionOver(
  options: {
    url?: string;
    playerId?: string;
    reconnectDelayMs?: number;
    maxReconnectAttempts?: number;
  } = {},
) {
  const sockets: FakeSocket[] = [];
  const statuses: MatchmakingStatus[] = [];
  const games: OnlineGame[] = [];
  const reviews: ReviewedGame[] = [];

  const session = new MatchmakingSession({
    url: options.url ?? "ws://matchmaking.test/ws",
    playerId: options.playerId ?? "player-one",
    reconnectDelayMs: options.reconnectDelayMs,
    maxReconnectAttempts: options.maxReconnectAttempts,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    onGame: (game) => games.push(game),
    onReview: (game) => reviews.push(game),
  });
  session.watch((status) => statuses.push(status));

  /** The socket the session is talking over, which it opens on demand. */
  const socket = (): FakeSocket => {
    const latest = sockets.at(-1);
    if (!latest) throw new Error("the session has not opened a socket");
    return latest;
  };

  return { session, socket, sockets, statuses, games, reviews };
}

/** Lets a reconnect, which waits on a timer, have its turn. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A listener that records everything the game told it. */
function recorder(): {
  listener: GameListener;
  events: string[];
} {
  const events: string[] = [];
  return {
    events,
    listener: {
      moved: (_board, pgn, _inCheck, color) =>
        events.push(`moved:${pgn}:${color}`),
      clock: (white, black, running) =>
        events.push(`clock:${white}:${black}:${running}`),
      moveRejected: (rejection) => events.push(`rejected:${rejection.reason}`),
      gameOver: (status, winner) => events.push(`over:${status}:${winner}`),
      opponentAway: (color) => events.push(`away:${color}`),
      opponentBack: (color) => events.push(`back:${color}`),
      drawOffered: (color) => events.push(`draw:${color}`),
      drawCancelled: (color) => events.push(`drawCancelled:${color}`),
      notice: (text) => events.push(`notice:${text}`),
      resuming: (attempt) => events.push(`resuming:${attempt}`),
      resumed: (_board, clock, offers, history) =>
        events.push(
          `resumed:${clock.white}:${clock.running}:${offers.length}:${history.moves.length}`,
        ),
      disconnected: () => events.push("disconnected"),
    },
  };
}

const BOARD: SerializedBoardState = {
  pieces: [],
  turn: "white",
  halfTurnNumber: 0,
  symbols: {},
};

/** The clocks the tests' games are played with. */
const TIME_CONTROL = {
  index: 1,
  label: "3+2",
  initialMs: 180_000,
  incrementMs: 2_000,
};

/** A `matched` message, with whatever the test cares about overridden. */
function matched(
  overrides: Partial<Extract<ServerMessage, { type: "matched" }>> = {},
): Extract<ServerMessage, { type: "matched" }> {
  return {
    type: "matched",
    gameId: "game-1",
    playerId: "player-one",
    color: "white",
    opponentName: "Bob",
    complexity: 0,
    complexityLabel: "normal chess",
    timeControl: TIME_CONTROL,
    board: BOARD,
    ...overrides,
  };
}

/** A `resumed` message, with whatever the test cares about overridden. */
function resumed(
  overrides: Partial<Extract<ServerMessage, { type: "resumed" }>> = {},
): Extract<ServerMessage, { type: "resumed" }> {
  return {
    type: "resumed",
    gameId: "game-1",
    playerId: "player-one",
    color: "white",
    playerName: "Ada",
    opponentName: "Bob",
    complexity: 0,
    complexityLabel: "normal chess",
    timeControl: TIME_CONTROL,
    board: BOARD,
    clock: { white: 120_000, black: 180_000, running: "white" },
    drawOffers: [],
    history: { initialBoard: BOARD, moves: [] },
    ...overrides,
  };
}

test("a new watcher is told the session is idle", () => {
  const { statuses } = sessionOver();
  assert.deepEqual(statuses, [{ state: "idle" }]);
});

test("queuing connects, then joins once the socket is up", () => {
  const { session, socket, statuses } = sessionOver();

  session.queue(2, 1, "Ada");
  assert.deepEqual(statuses.at(-1), { state: "connecting" });
  // Nothing may be sent before the socket is open.
  assert.deepEqual(socket().sent, []);

  socket().open();
  assert.deepEqual(socket().sent, [
    '{"type":"join","complexity":2,"timeControl":1,"name":"Ada","playerId":"player-one"}',
  ]);

  socket().receive({ type: "queued", complexity: 2, timeControl: 1, waiting: 3 });
  assert.deepEqual(statuses.at(-1), { state: "queued", waiting: 3 });
});

test("asking again while queued updates the level without reconnecting", () => {
  const { session, socket, sockets } = sessionOver();
  session.queue(2, 1, "Ada");
  socket().open();
  socket().receive({ type: "queued", complexity: 2, timeControl: 1, waiting: 1 });

  session.queue(3, 2, "Ada");
  assert.equal(sockets.length, 1);
  assert.equal(
    socket().sent.at(-1),
    '{"type":"join","complexity":3,"timeControl":2,"name":"Ada","playerId":"player-one"}',
  );
});

test("cancelling a search tells the server", () => {
  const { session, socket, statuses } = sessionOver();
  session.queue(1, 0, "");
  socket().open();

  session.cancel();
  assert.deepEqual(socket().sent, [
    '{"type":"join","complexity":1,"timeControl":0,"playerId":"player-one"}',
    '{"type":"cancelQueue"}',
  ]);
  assert.deepEqual(statuses.at(-1), { state: "idle" });

  // The answer to the cancel leaves the session idle, not queued again.
  socket().receive({ type: "queueCancelled" });
  assert.deepEqual(statuses.at(-1), { state: "idle" });
});

test("cancelling before the socket opens never joins at all", () => {
  const { session, socket, statuses } = sessionOver();
  session.queue(1, 0, "");
  session.cancel();
  socket().open();

  assert.deepEqual(socket().sent, []);
  assert.deepEqual(statuses.at(-1), { state: "idle" });
});

test("a game is handed over with everything the board needs", () => {
  const { session, socket, statuses, games } = sessionOver();
  session.queue(2, 1, "Ada");
  socket().open();
  socket().receive(matched({
    color: "black",
    complexity: 1,
    complexityLabel: "one fairy piece",
  }));

  const game = games.at(-1);
  assert.ok(game, "the app should be handed the game");
  assert.equal(game.color, "black");
  assert.equal(game.playerName, "Ada");
  assert.equal(game.opponentName, "Bob");
  assert.equal(game.complexityLabel, "one fairy piece");
  assert.deepEqual(game.timeControl, TIME_CONTROL);
  assert.deepEqual(game.board, BOARD);
  // The search is over, so a screen showing the home page has its button back.
  assert.deepEqual(statuses.at(-1), { state: "idle" });
});

test("what the player asks for goes to the server as a message", () => {
  const { session, socket, games } = sessionOver();
  session.queue(0, 0, "");
  socket().open();
  socket().receive(matched());
  const game = games.at(-1)!;

  game.requestMove({
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });
  game.offerDraw();
  game.cancelDraw();
  game.resign();
  game.abort();
  assert.deepEqual(socket().sent.slice(1), [
    '{"type":"move","pieceId":4,"from":{"x":4,"y":1},"to":{"x":4,"y":3}}',
    '{"type":"offerDraw"}',
    '{"type":"cancelDraw"}',
    '{"type":"resign"}',
    '{"type":"abort"}',
  ]);
});

test("the game hears about everything that happens in it", () => {
  const { session, socket, games } = sessionOver();
  session.queue(0, 0, "");
  socket().open();
  socket().receive(matched());

  const { listener, events } = recorder();
  games.at(-1)!.listen(listener);

  socket().receive({
    type: "moved",
    color: "white",
    move: {
      pieceId: 4,
      piece: "pawn",
      from: { x: 4, y: 1 },
      to: { x: 4, y: 3 },
      type: "move",
    },
    pgn: "e4",
    board: BOARD,
    inCheck: false,
  });
  socket().receive({ type: "clock", white: 182_000, black: 180_000, running: null });
  socket().receive({
    type: "moveRejected",
    rejection: { reason: "not-your-turn" },
  });
  socket().receive({ type: "drawOffered", color: "black" });
  socket().receive({ type: "drawCancelled", color: "black" });
  socket().receive({ type: "error", message: "Something went wrong." });
  socket().receive({ type: "gameOver", status: "draw", winner: "draw" });

  assert.deepEqual(events, [
    "moved:e4:white",
    "clock:182000:180000:null",
    "rejected:not-your-turn",
    "draw:black",
    "drawCancelled:black",
    "notice:Something went wrong.",
    "over:draw:draw",
  ]);
});

test("a game that was called off is reported with no winner", () => {
  const { session, socket, games } = sessionOver();
  session.queue(0, 0, "");
  socket().open();
  socket().receive(matched());

  const { listener, events } = recorder();
  games.at(-1)!.listen(listener);
  socket().receive({ type: "gameOver", status: "abort", winner: null });

  assert.deepEqual(events, ["over:abort:null"]);
  assert.equal(session.currentGame, null);
});

test("a finished game makes room for another search", () => {
  const { session, socket, sockets } = sessionOver();
  session.queue(2, 1, "Ada");
  socket().open();
  socket().receive(matched({ complexity: 2, complexityLabel: "several fairy pieces" }));
  socket().receive({ type: "gameOver", status: "checkmate", winner: "white" });

  // The socket is still up, so the next search joins over it rather than
  // opening another one.
  session.queue(2, 1, "Ada");
  assert.equal(sockets.length, 1);
  assert.equal(
    socket().sent.at(-1),
    '{"type":"join","complexity":2,"timeControl":1,"name":"Ada","playerId":"player-one"}',
  );
});

test("the opponent going away is reported without ending the game", () => {
  const { session, socket, games } = sessionOver();
  session.queue(0, 0, "");
  socket().open();
  socket().receive(matched());

  const { listener, events } = recorder();
  games.at(-1)!.listen(listener);
  socket().receive({ type: "opponentAway", color: "black" });
  socket().receive({ type: "opponentBack", color: "black" });

  assert.deepEqual(events, ["away:black", "back:black"]);
  assert.equal(session.currentGame, games.at(-1));
});

test("a game whose connection drops is taken back over a new socket", async () => {
  const { session, socket, sockets, games } = sessionOver({
    reconnectDelayMs: 0,
    maxReconnectAttempts: 3,
  });
  session.queue(0, 0, "");
  socket().open();
  socket().receive(matched());

  const { listener, events } = recorder();
  games.at(-1)!.listen(listener);
  socket().emit("close", {});
  assert.deepEqual(events, ["resuming:1"]);

  // The seat is asked for again over a fresh socket, with the game and player.
  await tick();
  assert.equal(sockets.length, 2);
  sockets[1].open();
  assert.deepEqual(sockets[1].sent, [
    '{"type":"rejoin","gameId":"game-1","playerId":"player-one"}',
  ]);

  sockets[1].receive(resumed());
  assert.deepEqual(events, ["resuming:1", "resumed:120000:white:0:0"]);
  // The same game object is kept, so the board already on screen is updated.
  assert.equal(games.length, 1);
  assert.equal(session.currentGame, games[0]);
});

test("a connection that cannot be restored ends the game", async () => {
  const { session, socket, sockets, games } = sessionOver({
    reconnectDelayMs: 0,
    maxReconnectAttempts: 1,
  });
  session.queue(0, 0, "");
  socket().open();
  socket().receive(matched());

  const { listener, events } = recorder();
  games.at(-1)!.listen(listener);
  socket().emit("close", {});

  // The single attempt opens a socket that then fails too, so it is given up.
  await tick();
  assert.equal(sockets.length, 2);
  sockets[1].open();
  sockets[1].emit("close", {});
  assert.deepEqual(events, ["resuming:1", "disconnected"]);
  assert.equal(session.currentGame, null);
});

test("a game named in the address bar is rejoined when the page loads", () => {
  const { session, socket, games } = sessionOver();
  session.resume("game-9");
  assert.deepEqual(session.status, { state: "connecting" });

  socket().open();
  assert.deepEqual(socket().sent, [
    '{"type":"rejoin","gameId":"game-9","playerId":"player-one"}',
  ]);

  socket().receive(resumed({ gameId: "game-9", color: "black", playerName: "Bob" }));
  const game = games.at(-1);
  assert.ok(game, "the rejoined game should be handed over");
  assert.equal(game.gameId, "game-9");
  assert.equal(game.color, "black");
  assert.equal(game.playerName, "Bob");
  assert.deepEqual(game.clock, { white: 120_000, black: 180_000, running: "white" });
  assert.deepEqual(session.status, { state: "idle" });
});

test("a finished game shared by its link is handed over for reading", () => {
  const { session, socket, reviews } = sessionOver();
  session.resume("game-9");
  socket().open();

  socket().receive({
    type: "reviewed",
    gameId: "game-9",
    color: "black",
    whiteName: "Ada",
    blackName: "Bob",
    complexity: 0,
    complexityLabel: "normal chess",
    timeControl: TIME_CONTROL,
    result: { status: "checkmate", winner: "white" },
    initialBoard: BOARD,
    moves: [],
  });

  const review = reviews.at(-1);
  assert.ok(review, "the game should be handed over to be read");
  assert.equal(review.gameId, "game-9");
  assert.equal(review.color, "black");
  assert.equal(review.whiteName, "Ada");
  assert.equal(review.blackName, "Bob");
  assert.equal(review.result.status, "checkmate");
  // Nothing is being played, so there is no game to hold on to.
  assert.equal(session.currentGame, null);
  assert.deepEqual(session.status, { state: "idle" });
});

test("a search that loses its connection says so", () => {
  const { session, socket, statuses } = sessionOver();
  session.queue(0, 0, "");
  socket().open();
  socket().emit("close", {});

  const last = statuses.at(-1);
  assert.equal(last?.state, "error");
  assert.match(
    last?.state === "error" ? last.message : "",
    /connection to the matchmaking server was lost/,
  );
});

test("a server this build cannot speak to ends the search", () => {
  const { session, socket } = sessionOver();
  session.queue(0, 0, "");
  socket().open();
  socket().receive({
    type: "welcome",
    protocolVersion: 99,
    minComplexity: 0,
    maxComplexity: 4,
    complexityLabels: [],
    timeControlLabels: [],
  });

  assert.equal(session.status.state, "error");
  assert.equal(socket().closed, true);
});

test("the level asked for is kept to the ones the server knows", () => {
  const { session, socket } = sessionOver();
  session.queue(4, 0, "");
  socket().open();
  socket().receive({
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    minComplexity: 0,
    maxComplexity: 2,
    complexityLabels: ["normal chess", "one fairy piece", "several fairy pieces"],
    timeControlLabels: ["1+2", "3+2", "5+5", "10+10"],
  });

  assert.equal(session.complexityLabel, "several fairy pieces");
  socket().receive({ type: "queued", complexity: 2, timeControl: 0, waiting: 1 });
  assert.equal(session.complexityLabel, "several fairy pieces");
});

test("the clock asked for is kept to the ones the server knows", () => {
  const { session, socket } = sessionOver();
  session.queue(0, 3, "");
  assert.equal(session.timeControlLabel, "10+10");

  socket().open();
  // A clock this build does not know is kept to the ones that exist.
  session.queue(0, 99, "");
  assert.equal(session.timeControlLabel, "10+10");

  // A server that offers fewer clocks narrows it further.
  socket().receive({
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    minComplexity: 0,
    maxComplexity: 4,
    complexityLabels: ["a", "b", "c", "d", "e"],
    timeControlLabels: ["1+2", "3+2"],
  });
  assert.equal(session.timeControlLabel, "3+2");
});
