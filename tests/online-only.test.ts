import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMove,
  type ChessBoardState,
  type Piece,
  type SpecialMovement,
  type TaggedMove,
} from "../src/chess-board.ts";
import { ChessGame } from "../src/chess-game.ts";
import { betzaFeatures } from "../src/pieces/betza.ts";
import { getBehavior } from "../src/pieces/behavior.ts";
import pieceTypes from "../src/pieces/piece_types/index.ts";
import type { PieceType } from "../src/pieces/piece_types/index.ts";
import { Xoshiro128ss } from "../src/random.ts";
import { applyChaos, chaosLevels } from "../src/replacement-rules.ts";
import { algebraicFromTile, buildState } from "./helpers.ts";

const ignore = () => {};

/** A movement tagged with the piece that makes it, ready for {@link applyMove}. */
function tag(piece: Piece, move: SpecialMovement): TaggedMove {
  return { ...move, from: piece.position, piece, promotion: undefined };
}

/** The squares a piece may move to, as algebraic names. */
function destinations(state: ChessBoardState, index = 0): string[] {
  const piece = state.pieces[index];
  return getBehavior(piece.type)(piece, state)
    .map((move) => algebraicFromTile(move.to))
    .sort();
}

test("the extended Betza features are recognised", () => {
  assert.equal(betzaFeatures("R").stockfishIncompatible, false);
  assert.equal(betzaFeatures("xxU").stockfishIncompatible, true);
  assert.equal(betzaFeatures("mU").stockfishIncompatible, true);
  assert.equal(betzaFeatures("wB").stockfishIncompatible, true);
  assert.equal(betzaFeatures("d(anchor)R").stockfishIncompatible, true);
  assert.equal(betzaFeatures("T").stockfishIncompatible, true);
  assert.equal(betzaFeatures("d(anchor)R").drop, "anchor");
  assert.equal(betzaFeatures("T").temporary, true);
  assert.equal(betzaFeatures("R").temporary, false);
});

test("the magician swaps with a friendly piece and does nothing else", () => {
  const state = buildState(
    [
      { type: pieceTypes.magician, color: "white", square: "d4" },
      { type: pieceTypes.pawn, color: "white", square: "f6" },
      { type: pieceTypes.pawn, color: "black", square: "b2" },
    ],
    "white",
  );
  const moves = getBehavior(pieceTypes.magician)(state.pieces[0], state);
  assert.deepEqual(moves.map((move) => algebraicFromTile(move.to)), ["f6"]);
  assert.equal(moves[0].swap, state.pieces[1]);
  assert.equal(moves[0].type, "move");
});

test("the chimpanzee reaches every empty square but cannot capture", () => {
  const state = buildState(
    [
      { type: pieceTypes.chimpanzee, color: "white", square: "d4" },
      { type: pieceTypes.pawn, color: "white", square: "f6" },
      { type: pieceTypes.pawn, color: "black", square: "b2" },
    ],
    "white",
  );
  const moves = getBehavior(pieceTypes.chimpanzee)(state.pieces[0], state);
  assert.ok(moves.every((move) => move.type === "move"));
  // Every square but the origin, the friendly pawn and the enemy pawn.
  assert.equal(moves.length, 61);
  assert.ok(!moves.some((move) => move.to.x === 5 && move.to.y === 5));
  assert.ok(!moves.some((move) => move.to.x === 1 && move.to.y === 1));
});

test("the snake bounces off the walls", () => {
  const state = buildState(
    [{ type: pieceTypes.snake, color: "white", square: "d4" }],
    "white",
  );
  assert.deepEqual(destinations(state), [
    "a1",
    "a7",
    "b2",
    "b6",
    "b8",
    "c3",
    "c5",
    "c7",
    "d6",
    "e3",
    "e5",
    "f2",
    "f4",
    "f6",
    "g1",
    "g3",
    "g7",
    "h2",
    "h8",
  ]);
});

test("the spider drops an anchor on every square it passes over", () => {
  const state = buildState(
    [{ type: pieceTypes.spider, color: "white", square: "d4" }],
    "white",
  );
  const spider = state.pieces[0];
  const move = getBehavior(pieceTypes.spider)(spider, state).find(
    (candidate) => candidate.to.x === 3 && candidate.to.y === 6,
  )!;
  assert.deepEqual(
    move.drops?.map((drop) => algebraicFromTile(drop.tile)),
    ["d5", "d6"],
  );
});

test("a swap trades the two pieces' squares", () => {
  const state = buildState(
    [
      { type: pieceTypes.magician, color: "white", square: "d4" },
      { type: pieceTypes.pawn, color: "white", square: "f6" },
    ],
    "white",
  );
  const magician = state.pieces[0];
  const move = getBehavior(pieceTypes.magician)(magician, state)[0];
  applyMove(state, tag(magician, move), ignore, ignore, ignore);
  assert.deepEqual(magician.position, { x: 5, y: 5 });
  assert.deepEqual(state.pieces[1].position, { x: 3, y: 3 });
});

test("anchors vanish at the start of their owner's next turn", () => {
  const state = buildState(
    [
      { type: pieceTypes.spider, color: "white", square: "d4" },
      { type: pieceTypes.pawn, color: "black", square: "a7" },
    ],
    "white",
  );
  const spider = state.pieces[0];
  const move = getBehavior(pieceTypes.spider)(spider, state).find(
    (candidate) => candidate.to.x === 3 && candidate.to.y === 6,
  )!;
  applyMove(state, tag(spider, move), ignore, ignore, ignore);
  assert.equal(state.turn, "black");
  assert.deepEqual(
    state.pieces
      .filter((piece) => piece.type === pieceTypes.anchor)
      .map((piece) => algebraicFromTile(piece.position))
      .sort(),
    ["d5", "d6"],
  );

  // Black plays a move; the anchors belong to white, so they survive it.
  const pawn = state.pieces.find((piece) => piece.type === pieceTypes.pawn)!;
  const pawnMove = getBehavior(pieceTypes.pawn)(pawn, state)[0];
  applyMove(state, tag(pawn, pawnMove), ignore, ignore, ignore);
  assert.equal(state.turn, "white");
  assert.equal(
    state.pieces.filter((piece) => piece.type === pieceTypes.anchor).length,
    0,
  );
});

test("every registered piece's onlineOnly flag matches its Betza", () => {
  for (const [name, type] of Object.entries(pieceTypes)) {
    assert.equal(
      betzaFeatures(type.betza).stockfishIncompatible,
      type.onlineOnly === true,
      `${name} (${type.betza}) is inconsistent`,
    );
  }
});

test("a piece's onlineOnly flag must match its Betza", () => {
  const wronglyAllowed = {
    ...pieceTypes.magician,
    displayName: "Wrongly allowed",
    onlineOnly: false,
  } as PieceType;
  assert.throws(() => getBehavior(wronglyAllowed), /onlineOnly/);

  const wronglyBlocked = {
    ...pieceTypes.rook,
    displayName: "Wrongly blocked",
    onlineOnly: true,
  } as PieceType;
  assert.throws(() => getBehavior(wronglyBlocked), /onlineOnly/);
});

test("online-only pieces are kept out of a game with an AI", () => {
  const base = ChessGame.defaultLayout(chaosLevels[0]).state;
  for (const level of chaosLevels) {
    for (let seed = 0; seed < 40; seed++) {
      const board = { ...base, pieces: base.pieces.map((piece) => ({ ...piece })) };
      applyChaos(
        board,
        level,
        new Xoshiro128ss(seed, seed + 1, seed + 2, seed + 3),
        false,
      );
      assert.ok(
        board.pieces.every((piece) => !piece.type.onlineOnly),
        `${level.label} (seed ${seed}) produced an online-only piece`,
      );
    }
  }
});
