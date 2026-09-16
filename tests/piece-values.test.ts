import assert from "node:assert/strict";
import { test } from "node:test";
import { builtInTypes } from "../src/ai/variant.ts";
import { parseBetza } from "../src/pieces/betza.ts";
import pieceTypes from "../src/pieces/piece_types/index.ts";

type MoveSpec = ReturnType<typeof parseBetza>[number];

/**
 * The predefined middlegame values Fairy-Stockfish uses for its built-in piece
 * types, in the engine's material units, from `Value` in
 * `Fairy-Stockfish/src/types.h`. The engine only runs its automatic
 * {@link estimatePieceValue} estimator for pieces without a built-in type; a
 * piece that maps to a built-in type (see `builtInTypes`) keeps the built-in's
 * precalculated value instead.
 */
const BUILT_IN_VALUES = new Map<string, number>([
  ["pawn", 126],
  ["knight", 781],
  ["bishop", 825],
  ["rook", 1276],
  ["queen", 2538],
  ["king", 0],
  ["wazir", 400],
  ["fers", 420],
  ["chancellor", 2300],
  ["archbishop", 2200],
  ["amazon", 2700],
  ["centaur", 1800],
]);

/**
 * Fairy-Stockfish measures piece values in its own material units rather than
 * in pawns; the rook is worth 1276 of them. Its documentation names the rook as
 * the gauge for the scale, and our rook is worth 5, so one of our points is
 * 1276 / 5 units.
 */
const ROOK_VALUE = 1276;
const ROOK_POINTS = 5.027;
const POINTS_PER_UNIT = ROOK_POINTS / ROOK_VALUE;

/** `slider_fraction` from `Fairy-Stockfish/src/psqt.cpp`. */
function sliderFraction(limits: number[]): number {
  return limits.reduce(
    (total, limit) =>
      total +
      (limit === 0 ? 100 : Math.floor((200 * Math.min(limit + 1, 8)) / 16)),
    0,
  );
}

/** Whether a direction is orthogonal (north, east, south or west). */
function isOrthogonal(direction: { x: number; y: number }): boolean {
  return (
    (direction.x === 0 && Math.abs(direction.y) === 1) ||
    (direction.y === 0 && Math.abs(direction.x) === 1)
  );
}

/**
 * `piece_value()` from `Fairy-Stockfish/src/psqt.cpp`: the estimate the engine
 * makes for a custom piece's middlegame value, in the engine's material units.
 * It counts the directions the piece can step, slide and hop in, weighting each
 * kind by how useful it tends to be, and grows slightly with the total so that
 * more mobile pieces are valued superlinearly.
 */
function estimatePieceValue(betza: string): number {
  // Only the steady-state moves count, not the one-off `i` (initial) moves.
  const specs = parseBetza(betza).filter((spec) => !spec.initial);
  const steps = (capture: boolean): MoveSpec[] =>
    specs.filter(
      (spec) =>
        (spec.kind === "step" || spec.kind === "lame") &&
        spec.capture === capture,
    );
  const riders = (capture: boolean): MoveSpec[] =>
    specs.filter((spec) => spec.kind === "rider" && spec.capture === capture);
  const hoppers = (capture: boolean): MoveSpec[] =>
    specs.filter((spec) => spec.kind === "hopper" && spec.capture === capture);

  const units =
    60 * steps(true).length +
    30 * steps(false).length +
    Math.floor(
      (185 * sliderFraction(riders(true).map((spec) => spec.limit))) / 100,
    ) +
    Math.floor(
      (55 * sliderFraction(riders(false).map((spec) => spec.limit))) / 100,
    ) +
    100 * hoppers(true).length +
    85 * hoppers(false).length +
    15 * riders(true).filter((spec) => isOrthogonal(spec.direction)).length +
    30 * riders(false).filter((spec) => isOrthogonal(spec.direction)).length;

  return Math.trunc(units * Math.exp(units / 10000));
}

/** The value the engine uses for a piece, in the same units as `value`. */
function engineValue(betza: string): number {
  const builtIn = builtInTypes[betza];
  if (builtIn === undefined) return estimatePieceValue(betza) * POINTS_PER_UNIT;
  const value = BUILT_IN_VALUES.get(builtIn);
  if (value === undefined) {
    throw new Error(`No predefined value recorded for built-in type ${builtIn}`);
  }
  return value * POINTS_PER_UNIT;
}

test("every piece type's value matches the engine's estimate", () => {
  const mismatches: string[] = [];
  for (const [name, type] of Object.entries(pieceTypes)) {
    const estimate = engineValue(type.betza);
    // Our values are rough integers, so a difference of up to one point is
    // treated as a match.
    if (Math.abs(estimate - type.value) > 1) {
      mismatches.push(
        `${name} (${type.betza}): we say ${type.value}, the engine estimates ${estimate.toFixed(2)}`,
      );
    }
  }
  assert.deepEqual(mismatches, [], "piece values differ from the engine");
});
