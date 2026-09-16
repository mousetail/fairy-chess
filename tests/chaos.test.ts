import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChessBoardState, Piece } from "../src/chess-board.ts";
import { ChessGame } from "../src/chess-game.ts";
import pieceTypes from "../src/pieces/piece_types/index.ts";
import {
  addedValue,
  applyChaos,
  chaosLevels,
  keepsBalance,
  replacementRules,
} from "../src/replacement-rules.ts";

/**
 * A small deterministic PRNG, so a test can replay the same randomised setup
 * every run. The rules pick their pieces with `Math.random` rather than this
 * generator, so only the sequence of chosen rules is reproducible.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The starting position, before any chaos is applied. */
function startingBoard(): ChessBoardState {
  return ChessGame.defaultLayout(chaosLevels[0]).state;
}

function material(board: ChessBoardState, color: "white" | "black"): number {
  return board.pieces
    .filter((piece) => piece.color === color)
    .reduce((total, piece) => total + piece.type.value, 0);
}

/** The single royal piece of a colour, checking that there is exactly one. */
function royal(board: ChessBoardState, color: "white" | "black"): Piece {
  const royals = board.pieces.filter(
    (piece) => piece.color === color && piece.type.royal,
  );
  assert.equal(royals.length, 1, `${color} should have one royal piece`);
  return royals[0];
}

/** The pieces on the board as `color:type` keys with their counts. */
function pieceCounts(board: ChessBoardState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const piece of board.pieces) {
    const key = `${piece.color}:${piece.type.displayName}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const fullChaos = chaosLevels.filter((level) => level.budget === Infinity);

test("a rule is only allowed when it keeps the balance near level", () => {
  // A side ahead by 4 may lose value or stay level, but not add value.
  assert.equal(keepsBalance(3, 4), false);
  assert.equal(keepsBalance(0, 4), true);
  assert.equal(keepsBalance(-3, 4), true);
  // A side behind by 4 may add value or stay level, but not fall further behind.
  assert.equal(keepsBalance(3, -4), true);
  assert.equal(keepsBalance(0, -4), true);
  assert.equal(keepsBalance(-3, -4), false);
  // Level sides may take any rule.
  assert.equal(keepsBalance(3, 0), true);
  assert.equal(keepsBalance(-3, 0), true);
});

test("a rule reports the value it adds, including a positional override", () => {
  const board = startingBoard();
  const rule = (name: string) =>
    replacementRules.find((candidate) => candidate.name === name)!;
  assert.equal(addedValue(rule("Rook → Knook"), board, "white"), 4);
  assert.equal(addedValue(rule("Rook → Wazir"), board, "white"), -3);
  // Commoners are worth the same as pawns, but the rule adds a positional 3.
  assert.equal(addedValue(rule("Pawns → Commoners"), board, "white"), 3);
});

test("full chaos keeps the classic king about three quarters of the time", () => {
  const runs = 2000;
  for (const level of fullChaos) {
    const random = seededRandom(1234);
    let variants = 0;
    for (let i = 0; i < runs; i++) {
      const board = startingBoard();
      applyChaos(board, level, random);
      if (royal(board, "white").type !== pieceTypes.king) variants++;
    }
    const rate = variants / runs;
    assert.ok(
      rate > 0.2 && rate < 0.3,
      `${level.label}: king variants in ${(rate * 100).toFixed(1)}% of games`,
    );
  }
});

test("chaos never gives the two sides different kings", () => {
  const random = seededRandom(7);
  for (let i = 0; i < 500; i++) {
    for (const level of chaosLevels) {
      const board = startingBoard();
      applyChaos(board, level, random);
      assert.equal(
        royal(board, "white").type,
        royal(board, "black").type,
        level.label,
      );
    }
  }
});

test("symmetric chaos keeps the two sides material level", () => {
  const random = seededRandom(21);
  for (const level of chaosLevels.filter((candidate) => !candidate.asymmetric)) {
    for (let i = 0; i < 200; i++) {
      const board = startingBoard();
      applyChaos(board, level, random);
      assert.equal(
        material(board, "white"),
        material(board, "black"),
        level.label,
      );
    }
  }
});

test("full random asymmetric games stay near level", () => {
  const level = chaosLevels.find((candidate) => candidate.asymmetric)!;
  const random = seededRandom(99);
  const runs = 1000;
  const imbalances: number[] = [];
  for (let i = 0; i < runs; i++) {
    const board = startingBoard();
    applyChaos(board, level, random);
    imbalances.push(
      Math.abs(material(board, "white") - material(board, "black")),
    );
  }
  imbalances.sort((a, b) => a - b);
  const median = imbalances[runs / 2];
  const p90 = imbalances[Math.floor(runs * 0.9)];
  // Overshooting level is allowed, so a rare game can still swing far; the
  // balance rule is about keeping the typical game level.
  assert.ok(median <= 10, `median imbalance ${median}`);
  assert.ok(p90 <= 50, `90th percentile imbalance ${p90}`);
});

test("the same rule sequence produces the same setup", () => {
  const level = chaosLevels.at(-1)!;
  const first = startingBoard();
  applyChaos(first, level, seededRandom(5));
  const second = startingBoard();
  applyChaos(second, level, seededRandom(5));
  assert.deepEqual(pieceCounts(first), pieceCounts(second));
});
