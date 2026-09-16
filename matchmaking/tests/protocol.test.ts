import assert from "node:assert/strict";
import { ChessGame } from "../../src/chess-game.ts";
import {
  deserializeBoardState,
  pieceTypeKey,
  serializeBoardState,
  serializeMove,
} from "../../src/online/serialization.ts";
import { chaosLevels } from "../../src/replacement-rules.ts";
import pieceTypes from "../../src/pieces/piece_types/index.ts";
import { parseClientMessage } from "../parse.ts";

Deno.test("a board survives a round trip through JSON", () => {
  for (const level of chaosLevels) {
    const state = ChessGame.defaultLayout(level).state;
    const encoded = JSON.parse(
      JSON.stringify(serializeBoardState(state)),
    ) as ReturnType<typeof serializeBoardState>;
    const restored = deserializeBoardState(encoded);

    assert.equal(restored.turn, state.turn);
    assert.equal(restored.pieces.length, state.pieces.length);
    assert.deepEqual(
      restored.pieces.map((piece) => ({
        id: piece.id,
        type: pieceTypeKey(piece.type),
        color: piece.color,
        position: piece.position,
        hasMoved: piece.hasMoved,
      })),
      state.pieces.map((piece) => ({
        id: piece.id,
        type: pieceTypeKey(piece.type),
        color: piece.color,
        position: piece.position,
        hasMoved: piece.hasMoved,
      })),
    );
    // Piece types are objects with identity, so the whole point of the round
    // trip is that the same type objects come back out.
    for (const piece of restored.pieces) {
      const original = state.pieces.find(
        (candidate) => candidate.id === piece.id,
      );
      assert.equal(piece.type, original?.type, "piece types must be shared");
    }
    for (const [type, symbol] of state.symbols) {
      assert.equal(restored.symbols.get(type), symbol);
    }
  }
});

Deno.test("a move survives a round trip through JSON", () => {
  const session = ChessGame.defaultLayout(chaosLevels[0]);
  const piece = session.state.pieces.find((candidate) => candidate.id === 4)!;
  const move = {
    piece,
    from: piece.position,
    to: { x: 4, y: 3 },
    type: "move" as const,
  };

  const encoded = JSON.parse(JSON.stringify(serializeMove(move))) as ReturnType<
    typeof serializeMove
  >;
  assert.deepEqual(encoded, {
    pieceId: 4,
    piece: "pawn",
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
    type: "move",
  });
});

Deno.test("a promotion move names the piece it promotes to", () => {
  const session = ChessGame.defaultLayout(chaosLevels[0]);
  const piece = session.state.pieces.find((candidate) => candidate.id === 4)!;
  const encoded = serializeMove({
    piece,
    from: piece.position,
    to: { x: 4, y: 7 },
    type: "move",
    promotion: { state: "resolved", piece: pieceTypes.queen },
  });
  assert.equal(encoded.promotion, "queen");
});

Deno.test("an unknown piece type is rejected", () => {
  const board = serializeBoardState(
    ChessGame.defaultLayout(chaosLevels[0]).state,
  );
  assert.throws(
    () =>
      deserializeBoardState({
        ...board,
        pieces: [{ ...board.pieces[0], type: "dragon" }],
      }),
    /Unknown piece type key: dragon/,
  );
});

Deno.test("a well-formed join is accepted", () => {
  const parsed = parseClientMessage(
    JSON.stringify({ type: "join", complexity: 2, name: "Ada" }),
  );
  assert.deepEqual(parsed, {
    ok: true,
    message: { type: "join", complexity: 2, name: "Ada" },
  });
});

Deno.test("a well-formed move is accepted", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      type: "move",
      pieceId: 4,
      from: { x: 4, y: 1 },
      to: { x: 4, y: 3 },
      promotion: "queen",
    }),
  );
  assert.deepEqual(parsed, {
    ok: true,
    message: {
      type: "move",
      pieceId: 4,
      from: { x: 4, y: 1 },
      to: { x: 4, y: 3 },
      promotion: "queen",
    },
  });
});

Deno.test("malformed messages are refused with a reason", () => {
  const cases: [string, RegExp][] = [
    ["not json", /must be JSON/],
    ["[]", /must be objects/],
    [JSON.stringify({ type: "explode" }), /Unknown message type/],
    [JSON.stringify({ type: "join" }), /numeric complexity/],
    [
      JSON.stringify({ type: "join", complexity: 1, name: 5 }),
      /name must be a string/,
    ],
    [
      JSON.stringify({
        type: "move",
        pieceId: "4",
        from: { x: 1, y: 1 },
        to: { x: 2, y: 2 },
      }),
      /integer pieceId/,
    ],
    [
      JSON.stringify({
        type: "move",
        pieceId: 4,
        from: { x: 4, y: 8 },
        to: { x: 4, y: 3 },
      }),
      /on-board/,
    ],
    [
      JSON.stringify({
        type: "move",
        pieceId: 4,
        from: { x: 4 },
        to: { x: 4, y: 3 },
      }),
      /on-board/,
    ],
    [
      JSON.stringify({
        type: "move",
        pieceId: 4,
        from: [4, 1],
        to: { x: 4, y: 3 },
      }),
      /on-board/,
    ],
    [
      JSON.stringify({
        type: "move",
        pieceId: 4,
        from: { x: 4, y: 1 },
        to: { x: 4, y: 3 },
        promotion: 7,
      }),
      /piece type/,
    ],
  ];

  for (const [raw, expected] of cases) {
    const parsed = parseClientMessage(raw);
    assert.equal(parsed.ok, false, `expected ${raw} to be refused`);
    if (!parsed.ok) assert.match(parsed.error, expected, raw);
  }
});

Deno.test("the remaining client messages need no fields", () => {
  for (const type of ["cancelQueue", "resign", "offerDraw", "pong"]) {
    const parsed = parseClientMessage(JSON.stringify({ type }));
    assert.deepEqual(parsed, { ok: true, message: { type } });
  }
});
