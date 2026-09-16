import assert from "node:assert/strict";
import type { ServerMessage } from "../../src/online/protocol.ts";
import { type Client, Lobby, sanitizeName } from "../lobby.ts";

/** A client that keeps everything the lobby sends it. */
class FakeClient implements Client {
  readonly id: string;
  readonly received: ServerMessage[] = [];

  constructor(id: string) {
    this.id = id;
  }

  send(message: ServerMessage): void {
    this.received.push(message);
  }

  messages<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }>[] {
    return this.received.filter(
      (message): message is Extract<ServerMessage, { type: T }> =>
        message.type === type,
    );
  }

  last<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    return this.messages(type).at(-1);
  }
}

/** A lobby that always gives white to the player who joined first. */
function deterministicLobby(now: () => number = () => 0): Lobby {
  return new Lobby({ random: () => 0, now });
}

function join(
  lobby: Lobby,
  client: Client,
  complexity: number,
  name?: string,
  timeControl = 0,
): void {
  lobby.handleMessage(client, { type: "join", complexity, timeControl, name });
}

/** Joins `first` and `second` with matching preferences and returns the match. */
function matched(
  lobby: Lobby,
  first: FakeClient,
  second: FakeClient,
): { white: FakeClient; black: FakeClient } {
  join(lobby, first, 0);
  join(lobby, second, 0);
  const firstColor = first.last("matched")?.color;
  assert.ok(firstColor, "the first player should be matched");
  return firstColor === "white"
    ? { white: first, black: second }
    : { white: second, black: first };
}

Deno.test("players within one level are paired into a game", () => {
  const lobby = deterministicLobby();
  const first = new FakeClient("first");
  const second = new FakeClient("second");

  join(lobby, first, 1, "Ada");
  join(lobby, second, 2, "Bob");

  const firstMatch = first.last("matched");
  const secondMatch = second.last("matched");
  assert.ok(firstMatch && secondMatch, "both players should be matched");
  assert.equal(firstMatch.gameId, secondMatch.gameId);
  // 1 and 2 are a level apart, so they are matched at the less chaotic of the
  // two levels.
  assert.equal(firstMatch.complexity, 1);
  assert.equal(firstMatch.complexityLabel, "one fairy piece");
  assert.equal(firstMatch.color, "white");
  assert.equal(secondMatch.color, "black");
  assert.equal(firstMatch.opponentName, "Bob");
  assert.equal(secondMatch.opponentName, "Ada");
  assert.equal(firstMatch.board.pieces.length, 32);
  assert.equal(lobby.waitingCount, 0);
  assert.equal(lobby.gameCount, 1);
});

Deno.test("a game is played with the clock both players asked for", () => {
  const lobby = deterministicLobby();
  const first = new FakeClient("first");
  const second = new FakeClient("second");

  join(lobby, first, 0, "Ada", 2);
  join(lobby, second, 0, "Bob", 2);

  assert.deepEqual(first.last("matched")?.timeControl, {
    index: 2,
    label: "5+5",
    initialMs: 300_000,
    incrementMs: 5_000,
  });
});

Deno.test("players who want different clocks are not paired", () => {
  const lobby = deterministicLobby();
  const quick = new FakeClient("quick");
  const slow = new FakeClient("slow");

  join(lobby, quick, 0, undefined, 0);
  join(lobby, slow, 0, undefined, 3);

  assert.equal(quick.last("matched"), undefined);
  assert.equal(slow.last("matched"), undefined);
  assert.equal(quick.last("queued")?.timeControl, 0);
  assert.equal(slow.last("queued")?.timeControl, 3);
  assert.equal(lobby.waitingCount, 2);
});

Deno.test("players too far apart wait for someone closer", () => {
  const lobby = deterministicLobby();
  const calm = new FakeClient("calm");
  const chaotic = new FakeClient("chaotic");

  join(lobby, calm, 0);
  join(lobby, chaotic, 3);

  assert.equal(calm.last("matched"), undefined);
  assert.equal(chaotic.last("matched"), undefined);
  assert.equal(calm.last("queued")?.waiting, 1);
  assert.equal(chaotic.last("queued")?.waiting, 2);
  assert.equal(lobby.waitingCount, 2);
});

Deno.test("changing a preference keeps a player's place in the queue", () => {
  const lobby = deterministicLobby();
  const first = new FakeClient("first");
  const second = new FakeClient("second");

  join(lobby, first, 0);
  join(lobby, first, 4);

  assert.equal(lobby.waitingCount, 1);
  assert.equal(first.last("queued")?.complexity, 4);

  join(lobby, second, 4);
  const match = second.last("matched");
  assert.ok(match, "the patient player should be matched, not left behind");
  assert.equal(match.complexity, 4);
});

Deno.test("the longest waiting player is paired first", () => {
  const lobby = deterministicLobby();
  const waiting = new FakeClient("waiting");
  const later = new FakeClient("later");
  const arrival = new FakeClient("arrival");

  join(lobby, waiting, 1);
  join(lobby, later, 3);
  join(lobby, arrival, 2);

  assert.ok(waiting.last("matched"), "the longest wait should be served");
  assert.equal(
    arrival.last("matched")?.gameId,
    waiting.last("matched")?.gameId,
  );
  assert.equal(later.last("matched"), undefined);
  assert.equal(lobby.waitingCount, 1);
});

Deno.test("a player in a game cannot queue for another one", () => {
  const lobby = deterministicLobby();
  const first = new FakeClient("first");
  const second = new FakeClient("second");

  matched(lobby, first, second);
  join(lobby, first, 2);

  assert.equal(first.last("error")?.message, "You are already playing a game.");
  assert.equal(lobby.waitingCount, 0);
});

Deno.test("only an accepted move is relayed to both players", () => {
  const lobby = deterministicLobby();
  const players = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );
  const { white, black } = players;

  // White's e-pawn runs two squares.
  lobby.handleMessage(white, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });

  for (const client of [white, black]) {
    const moved = client.last("moved");
    assert.ok(moved, "both players should be told about the move");
    assert.equal(moved.color, "white");
    assert.equal(moved.pgn, "e4");
    assert.equal(moved.board.turn, "black");
    assert.equal(moved.inCheck, false);
  }

  // The same player cannot move again.
  lobby.handleMessage(white, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 3 },
    to: { x: 4, y: 4 },
  });
  assert.equal(white.last("moveRejected")?.rejection.reason, "not-your-turn");
  assert.equal(black.messages("moved").length, 1);
});

Deno.test("a refused move is only reported to the player who sent it", () => {
  const lobby = deterministicLobby();
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  // Black tries to move one of white's pawns while white is to move.
  lobby.handleMessage(black, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });

  assert.equal(black.last("moveRejected")?.rejection.reason, "not-your-turn");
  assert.equal(white.messages("moveRejected").length, 0);
  assert.equal(white.messages("moved").length, 0);
});

Deno.test("resigning ends the game for both players", () => {
  const lobby = deterministicLobby();
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, { type: "resign" });

  assert.deepEqual(white.last("gameOver"), {
    type: "gameOver",
    status: "resign",
    winner: "black",
  });
  assert.equal(black.last("gameOver")?.winner, "black");
  assert.equal(lobby.gameCount, 0);

  // Both players are free to look for another game.
  join(lobby, white, 0);
  assert.equal(white.last("queued")?.waiting, 1);
});

Deno.test("one player offering a draw does not end the game", () => {
  const lobby = deterministicLobby();
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, { type: "offerDraw" });

  // Both sides are told, so each can tell its own offer from the opponent's.
  assert.deepEqual(white.last("drawOffered"), {
    type: "drawOffered",
    color: "white",
  });
  assert.deepEqual(black.last("drawOffered"), {
    type: "drawOffered",
    color: "white",
  });
  assert.equal(white.messages("gameOver").length, 0);
  assert.equal(lobby.gameCount, 1);
});

Deno.test("the game is drawn once both players have offered one", () => {
  const lobby = deterministicLobby();
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, { type: "offerDraw" });
  lobby.handleMessage(black, { type: "offerDraw" });

  const drawn = { type: "gameOver", status: "draw", winner: "draw" };
  assert.deepEqual(white.last("gameOver"), drawn);
  assert.deepEqual(black.last("gameOver"), drawn);
  assert.equal(lobby.gameCount, 0);

  // The game is over, so there is nothing left to offer a draw in.
  lobby.handleMessage(white, { type: "offerDraw" });
  assert.equal(white.last("error")?.message, "You are not in a game yet.");
});

Deno.test("offering twice is not the same as the opponent offering", () => {
  const lobby = deterministicLobby();
  const { white } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, { type: "offerDraw" });
  lobby.handleMessage(white, { type: "offerDraw" });

  assert.equal(white.messages("drawOffered").length, 1);
  assert.equal(white.messages("gameOver").length, 0);
  assert.equal(lobby.gameCount, 1);
});

Deno.test("a move clears a draw offer that was standing", () => {
  const lobby = deterministicLobby();
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, { type: "offerDraw" });
  lobby.handleMessage(white, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });

  // The move took white's offer with it, so black's is a fresh one rather than
  // an answer to it, and the game carries on.
  lobby.handleMessage(black, { type: "offerDraw" });
  assert.equal(black.last("gameOver"), undefined);
  assert.equal(lobby.gameCount, 1);

  // Offering again, now that the move is behind them, does draw the game.
  lobby.handleMessage(white, { type: "offerDraw" });
  assert.equal(white.last("gameOver")?.winner, "draw");
  assert.equal(lobby.gameCount, 0);
});

Deno.test("a refused move leaves a standing offer alone", () => {
  const lobby = deterministicLobby();
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, { type: "offerDraw" });
  // Black is not to move, so this goes nowhere and clears nothing.
  lobby.handleMessage(black, {
    type: "move",
    pieceId: 12,
    from: { x: 4, y: 6 },
    to: { x: 4, y: 4 },
  });
  lobby.handleMessage(black, { type: "offerDraw" });

  assert.equal(black.last("gameOver")?.winner, "draw");
});

Deno.test("offering a draw without a game is reported", () => {
  const lobby = deterministicLobby();
  const client = new FakeClient("client");

  lobby.handleMessage(client, { type: "offerDraw" });

  assert.match(client.last("error")?.message ?? "", /not in a game/);
});

Deno.test("leaving mid-game hands the win to the opponent", () => {
  const lobby = deterministicLobby();
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.disconnect(white);

  assert.deepEqual(black.last("opponentLeft"), {
    type: "opponentLeft",
    winner: "black",
  });
  assert.equal(lobby.gameCount, 0);
});

Deno.test("leaving the queue drops the player without telling anyone", () => {
  const lobby = deterministicLobby();
  const waiting = new FakeClient("waiting");
  const other = new FakeClient("other");

  join(lobby, waiting, 2);
  lobby.disconnect(waiting);
  assert.equal(lobby.waitingCount, 0);

  join(lobby, other, 2);
  assert.equal(other.last("matched"), undefined);
  assert.equal(other.last("queued")?.waiting, 1);
});

Deno.test("cancelling takes a player out of the queue", () => {
  const lobby = deterministicLobby();
  const client = new FakeClient("client");
  join(lobby, client, 1);
  lobby.handleMessage(client, { type: "cancelQueue" });

  assert.deepEqual(client.last("queueCancelled"), { type: "queueCancelled" });
  assert.equal(lobby.waitingCount, 0);
});

Deno.test("acting without a game is reported rather than ignored", () => {
  const lobby = deterministicLobby();
  const client = new FakeClient("client");

  lobby.handleMessage(client, { type: "resign" });
  lobby.handleMessage(client, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });

  assert.equal(client.messages("error").length, 2);
});

Deno.test("a player-supplied name is sanitised", () => {
  assert.equal(sanitizeName("Ada"), "Ada");
  assert.equal(sanitizeName("  Ada  "), "Ada");
  assert.equal(sanitizeName(""), "Anonymous");
  assert.equal(sanitizeName("   "), "Anonymous");
  assert.equal(sanitizeName(undefined), "Anonymous");
  assert.equal(sanitizeName(42), "Anonymous");
  assert.equal(sanitizeName("bad\u0000\nname"), "badname");
  assert.equal(sanitizeName("a".repeat(40)).length, 24);
});

Deno.test("a player's clock only runs once both sides have moved", () => {
  let now = 0;
  const lobby = deterministicLobby(() => now);
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  // White's first move is free, and black's clock does not run either.
  lobby.handleMessage(white, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });
  assert.deepEqual(white.last("clock"), {
    type: "clock",
    white: 62_000,
    black: 60_000,
    running: null,
  });

  now = 5_000;
  lobby.handleMessage(black, {
    type: "move",
    pieceId: 12,
    from: { x: 4, y: 6 },
    to: { x: 4, y: 4 },
  });
  // Black's first move is free too, and now white is on the clock.
  assert.deepEqual(white.last("clock"), {
    type: "clock",
    white: 62_000,
    black: 62_000,
    running: "white",
  });

  now = 15_000;
  lobby.handleMessage(white, {
    type: "move",
    pieceId: 17,
    from: { x: 1, y: 0 },
    to: { x: 2, y: 2 },
  });
  // White used ten seconds and gained two, so 62 - 10 + 2 = 54.
  assert.deepEqual(white.last("clock"), {
    type: "clock",
    white: 54_000,
    black: 62_000,
    running: "black",
  });
});

Deno.test("a player who runs out of time loses", () => {
  let now = 0;
  const lobby = deterministicLobby(() => now);
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  // Both sides move, so white's clock starts running with 62 seconds on it.
  lobby.handleMessage(white, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });
  lobby.handleMessage(black, {
    type: "move",
    pieceId: 12,
    from: { x: 4, y: 6 },
    to: { x: 4, y: 4 },
  });

  // A second past the flag, which is the grace the server allows for lag.
  now = 63_001;
  lobby.tick();

  const lost = { type: "gameOver", status: "timeout", winner: "black" };
  assert.deepEqual(white.last("gameOver"), lost);
  assert.deepEqual(black.last("gameOver"), lost);
  assert.equal(lobby.gameCount, 0);
});

Deno.test("a move that arrives within the grace is still played", () => {
  let now = 0;
  const lobby = deterministicLobby(() => now);
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });
  lobby.handleMessage(black, {
    type: "move",
    pieceId: 12,
    from: { x: 4, y: 6 },
    to: { x: 4, y: 4 },
  });

  // Half a second past the flag, which the grace covers.
  now = 62_500;
  lobby.handleMessage(white, {
    type: "move",
    pieceId: 17,
    from: { x: 1, y: 0 },
    to: { x: 2, y: 2 },
  });

  assert.equal(white.last("moved")?.pgn, "Nc3");
  assert.equal(white.last("gameOver"), undefined);
  // The move was late, so the clock was settled below zero and the increment
  // brought it back up.
  assert.equal(white.last("clock")?.white, 1_500);
});

Deno.test("the clocks are sent again while one runs", () => {
  let now = 0;
  const lobby = deterministicLobby(() => now);
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });
  lobby.handleMessage(black, {
    type: "move",
    pieceId: 12,
    from: { x: 4, y: 6 },
    to: { x: 4, y: 4 },
  });
  const sent = white.messages("clock").length;

  now = 500;
  lobby.tick();
  assert.equal(white.messages("clock").length, sent, "too soon to send again");

  now = 1_000;
  lobby.tick();
  assert.equal(white.messages("clock").length, sent + 1);
  assert.equal(white.last("clock")?.running, "white");
});

Deno.test("a game can be called off before the player has moved", () => {
  const lobby = deterministicLobby();
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, { type: "abort" });

  const aborted = { type: "gameOver", status: "abort", winner: null };
  assert.deepEqual(white.last("gameOver"), aborted);
  assert.deepEqual(black.last("gameOver"), aborted);
  assert.equal(lobby.gameCount, 0);
});

Deno.test("a player who has moved cannot call the game off", () => {
  const lobby = deterministicLobby();
  const { white, black } = matched(
    lobby,
    new FakeClient("first"),
    new FakeClient("second"),
  );

  lobby.handleMessage(white, {
    type: "move",
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
  });
  lobby.handleMessage(white, { type: "abort" });

  assert.match(white.last("error")?.message ?? "", /already moved/);
  assert.equal(lobby.gameCount, 1);
  // Black has not moved, so black may still call it off.
  lobby.handleMessage(black, { type: "abort" });
  assert.equal(black.last("gameOver")?.status, "abort");
});

Deno.test("calling a game off without one is reported", () => {
  const lobby = deterministicLobby();
  const client = new FakeClient("client");

  lobby.handleMessage(client, { type: "abort" });

  assert.match(client.last("error")?.message ?? "", /not in a game/);
});
