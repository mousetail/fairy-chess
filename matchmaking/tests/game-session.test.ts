import assert from "node:assert/strict";
import type {
  Color,
  GameResult,
  MoveRejection,
} from "../../src/online/protocol.ts";
import { pieceTypeFromKey } from "../../src/online/serialization.ts";
import {
  type AppliedMove,
  GameSession,
  type MoveOutcome,
} from "../game-session.ts";
import { maxComplexity, minComplexity } from "../matchmaking.ts";

/** Plays a move with squares written as `[file, rank]`, both zero-based. */
function play(
  session: GameSession,
  color: Color,
  pieceId: number,
  from: [number, number],
  to: [number, number],
  promotion?: string,
): MoveOutcome {
  return session.play(color, {
    pieceId,
    from: { x: from[0], y: from[1] },
    to: { x: to[0], y: to[1] },
    promotion,
  });
}

function expectAccepted(outcome: MoveOutcome): AppliedMove {
  if (!outcome.ok) throw new Error(`move refused: ${outcome.rejection.reason}`);
  return outcome.applied;
}

function expectRefused(outcome: MoveOutcome): MoveRejection {
  if (outcome.ok) throw new Error("expected the move to be refused");
  return outcome.rejection;
}

function expectResult(outcome: MoveOutcome): GameResult {
  if (!outcome.ok) throw new Error(`move refused: ${outcome.rejection.reason}`);
  if (!outcome.result) throw new Error("expected the game to end");
  return outcome.result;
}

/** The piece type key of the piece with `id`, as a client would see it. */
function typeOf(session: GameSession, id: number): string | undefined {
  const board = session.serializeBoard();
  return board.pieces.find((piece) => piece.id === id)?.type;
}

Deno.test("the starting position is the standard one at the lowest level", () => {
  const session = new GameSession(0);
  const board = session.serializeBoard();

  assert.equal(session.complexity, 0);
  assert.equal(session.colorToMove, "white");
  assert.equal(session.finished, null);
  assert.equal(board.turn, "white");
  assert.equal(board.pieces.length, 32);
  assert.equal(
    board.pieces.filter((piece) => piece.color === "white").length,
    16,
  );
  assert.equal(typeOf(session, 4), "pawn");
});

Deno.test("a legal move is applied and the turn passes", () => {
  const session = new GameSession(0);
  const applied = expectAccepted(play(session, "white", 4, [4, 1], [4, 3]));

  assert.equal(applied.color, "white");
  assert.equal(applied.pgn, "e4");
  assert.equal(applied.inCheck, false);
  assert.equal(applied.board.turn, "black");
  assert.equal(session.colorToMove, "black");
});

Deno.test("a piece cannot be moved by the side that is not to move", () => {
  const session = new GameSession(0);
  const rejection = expectRefused(play(session, "black", 12, [4, 6], [4, 4]));
  assert.equal(rejection.reason, "not-your-turn");
});

Deno.test("the opponent's pieces cannot be moved on your own turn", () => {
  const session = new GameSession(0);
  const rejection = expectRefused(play(session, "white", 12, [4, 6], [4, 4]));
  assert.equal(rejection.reason, "not-your-piece");
});

Deno.test("a move to a square the piece cannot reach is refused", () => {
  const session = new GameSession(0);
  // The white rook on a1 is hemmed in by its own pawn and knight.
  const rejection = expectRefused(play(session, "white", 16, [0, 0], [0, 2]));
  assert.equal(rejection.reason, "illegal-move");
});

Deno.test("a move that starts on the wrong square is refused", () => {
  const session = new GameSession(0);
  const rejection = expectRefused(play(session, "white", 4, [6, 1], [6, 3]));
  assert.equal(rejection.reason, "stale-position");
});

Deno.test("a piece that is not on the board is refused", () => {
  const session = new GameSession(0);
  const rejection = expectRefused(play(session, "white", 999, [0, 1], [0, 3]));
  assert.equal(rejection.reason, "unknown-piece");
});

Deno.test("a move that leaves the king in check is refused", () => {
  const session = new GameSession(0);
  expectAccepted(play(session, "white", 4, [4, 1], [4, 3])); // e4
  expectAccepted(play(session, "black", 13, [5, 6], [5, 4])); // f5
  const check = expectAccepted(play(session, "white", 19, [3, 0], [7, 4])); // Qh5+
  assert.equal(check.inCheck, true);
  // f4 is a pawn move the piece can make, but it leaves the king in check.
  const rejection = expectRefused(play(session, "black", 13, [5, 4], [5, 3]));
  assert.equal(rejection.reason, "illegal-move");
});

Deno.test("checkmate is reported with the winner", () => {
  const session = new GameSession(0);
  expectAccepted(play(session, "white", 5, [5, 1], [5, 2])); // f3
  expectAccepted(play(session, "black", 12, [4, 6], [4, 4])); // e5
  expectAccepted(play(session, "white", 6, [6, 1], [6, 3])); // g4
  const result = expectResult(play(session, "black", 27, [3, 7], [7, 3])); // Qh4#

  assert.deepEqual(result, { status: "checkmate", winner: "black" });
  assert.deepEqual(session.finished, { status: "checkmate", winner: "black" });

  // The game is over, so nothing may be played any more.
  const rejection = expectRefused(play(session, "white", 20, [4, 0], [4, 3]));
  assert.equal(rejection.reason, "game-over");
});

Deno.test("reaching the far rank offers a choice of promotion", () => {
  const session = new GameSession(0);
  expectAccepted(play(session, "white", 0, [0, 1], [0, 3])); // a4
  expectAccepted(play(session, "black", 15, [7, 6], [7, 5])); // h6
  expectAccepted(play(session, "white", 0, [0, 3], [0, 4])); // a5
  expectAccepted(play(session, "black", 15, [7, 5], [7, 4])); // h5
  expectAccepted(play(session, "white", 0, [0, 4], [0, 5])); // a6
  expectAccepted(play(session, "black", 15, [7, 4], [7, 3])); // h4
  expectAccepted(play(session, "white", 0, [0, 5], [1, 6])); // axb7
  expectAccepted(play(session, "black", 15, [7, 3], [7, 2])); // h3

  const rejection = expectRefused(play(session, "white", 0, [1, 6], [0, 7]));
  assert.equal(rejection.reason, "promotion-required");
  assert.ok(
    rejection.reason === "promotion-required" &&
      rejection.options.includes("queen"),
    `queen should be offered, got ${JSON.stringify(rejection)}`,
  );

  const applied = expectAccepted(
    play(session, "white", 0, [1, 6], [0, 7], "queen"),
  );
  assert.equal(typeOf(session, 0), "queen");
  assert.equal(applied.board.pieces.some((piece) => piece.id === 24), false);
});

Deno.test("promoting to a piece the position does not offer is refused", () => {
  const session = new GameSession(0);
  expectAccepted(play(session, "white", 0, [0, 1], [0, 3]));
  expectAccepted(play(session, "black", 15, [7, 6], [7, 5]));
  expectAccepted(play(session, "white", 0, [0, 3], [0, 4]));
  expectAccepted(play(session, "black", 15, [7, 5], [7, 4]));
  expectAccepted(play(session, "white", 0, [0, 4], [0, 5]));
  expectAccepted(play(session, "black", 15, [7, 4], [7, 3]));
  expectAccepted(play(session, "white", 0, [0, 5], [1, 6]));
  expectAccepted(play(session, "black", 15, [7, 3], [7, 2]));

  // The king may never be promoted to, and an unknown piece does not exist.
  assert.equal(
    expectRefused(play(session, "white", 0, [1, 6], [0, 7], "king")).reason,
    "illegal-move",
  );
  assert.equal(
    expectRefused(play(session, "white", 0, [1, 6], [0, 7], "dragon")).reason,
    "illegal-move",
  );
});

Deno.test("a resignation hands the win to the opponent", () => {
  const session = new GameSession(0);
  assert.deepEqual(session.resign("white"), {
    status: "resign",
    winner: "black",
  });
  assert.deepEqual(session.finished, { status: "resign", winner: "black" });
  assert.equal(
    expectRefused(play(session, "black", 12, [4, 6], [4, 4])).reason,
    "game-over",
  );
});

Deno.test("an agreed draw ends the game level", () => {
  const session = new GameSession(0);
  assert.deepEqual(session.draw(), { status: "draw", winner: "draw" });
  assert.deepEqual(session.finished, { status: "draw", winner: "draw" });
  assert.equal(
    expectRefused(play(session, "white", 4, [4, 1], [4, 3])).reason,
    "game-over",
  );
});

Deno.test("every chaos level lays out a playable board", () => {
  for (let level = minComplexity; level <= maxComplexity; level++) {
    const session = new GameSession(level);
    const board = session.serializeBoard();
    assert.equal(board.turn, "white", `level ${level}: white moves first`);

    for (const color of ["white", "black"] as Color[]) {
      const royals = board.pieces.filter(
        (piece) => piece.color === color && pieceTypeFromKey(piece.type).royal,
      );
      assert.equal(
        royals.length,
        1,
        `level ${level}: ${color} needs one royal`,
      );
    }

    // The symbol map has to cover every piece type in play, with no repeats,
    // or the move log cannot name the pieces.
    const inPlay = [...new Set(board.pieces.map((piece) => piece.type))].sort();
    assert.deepEqual(Object.keys(board.symbols).sort(), inPlay);
    const symbols = Object.values(board.symbols).map((symbol) =>
      symbol.toLowerCase()
    );
    assert.equal(
      new Set(symbols).size,
      symbols.length,
      `level ${level}: symbols`,
    );
  }
});
