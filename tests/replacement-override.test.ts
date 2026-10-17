import assert from "node:assert/strict";
import { test } from "node:test";
import { ChessGame } from "../src/chess-game.ts";
import pieceTypes from "../src/pieces/piece_types/index.ts";
import { Xoshiro128ss } from "../src/random.ts";
import {
  applyChaos,
  chaosLevels,
  replacementRuleByName,
} from "../src/replacement-rules.ts";

/** A fresh standard position, ready for {@link applyChaos} to lay out. */
function standardBoard() {
  const base = ChessGame.defaultLayout(chaosLevels[0]).state;
  return { ...base, pieces: base.pieces.map((piece) => ({ ...piece })) };
}

/** How many pieces of `type` the board holds. */
function countOf(
  board: { pieces: { type: unknown }[] },
  type: unknown,
): number {
  return board.pieces.filter((piece) => piece.type === type).length;
}

test("an override rule is applied first when it fits the level", () => {
  const board = standardBoard();
  applyChaos(
    board,
    chaosLevels[1],
    new Xoshiro128ss(1, 2, 3, 4),
    true,
    replacementRuleByName("Rook → Ring"),
  );
  // Both colours take the rule, so both have a ring.
  assert.equal(countOf(board, pieceTypes.ring), 2);
});

test("an online-only override is skipped when the game cannot use it", () => {
  const board = standardBoard();
  applyChaos(
    board,
    chaosLevels[1],
    new Xoshiro128ss(1, 2, 3, 4),
    false,
    replacementRuleByName("Bishop → Snake"),
  );
  assert.equal(countOf(board, pieceTypes.snake), 0);
});

test("an override too complex for the level is skipped", () => {
  const withOverride = standardBoard();
  const without = standardBoard();
  applyChaos(
    withOverride,
    chaosLevels[1],
    new Xoshiro128ss(1, 2, 3, 4),
    true,
    replacementRuleByName("Pawns → Commoners"),
  );
  applyChaos(without, chaosLevels[1], new Xoshiro128ss(1, 2, 3, 4), true);
  // A skipped override consumes no randomness, so the layout is the one the
  // level would have produced on its own.
  assert.deepEqual(withOverride.pieces, without.pieces);
});

test("an override is ignored at the level that adds no pieces", () => {
  const board = standardBoard();
  applyChaos(
    board,
    chaosLevels[0],
    new Xoshiro128ss(1, 2, 3, 4),
    true,
    replacementRuleByName("Rook → Ring"),
  );
  assert.equal(countOf(board, pieceTypes.ring), 0);
});
