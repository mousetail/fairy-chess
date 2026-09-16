import assert from "node:assert/strict";
import {
  canMatch,
  chooseComplexity,
  chooseTimeControl,
  clampComplexity,
  maxComplexity,
  maxTimeControl,
  minComplexity,
  minTimeControl,
  type Preference,
} from "../matchmaking.ts";

/** A preference, with the clock defaulted to the first time control. */
function wants(complexity: number, timeControl = 0): Preference {
  return { complexity, timeControl };
}

/** A coin that always picks the first of the settings a pair accepts. */
const low = () => 0;

/** A coin that always picks the last of the settings a pair accepts. */
const high = () => 0.99;

Deno.test("players up to two levels apart may be paired", () => {
  assert.equal(canMatch(wants(0), wants(0)), true);
  assert.equal(canMatch(wants(1), wants(2)), true);
  assert.equal(canMatch(wants(2), wants(1)), true);
  // Each accepts a game one level from their own, so requests two apart fit on
  // the level in between.
  assert.equal(canMatch(wants(0), wants(2)), true);
  assert.equal(canMatch(wants(2), wants(0)), true);
  assert.equal(canMatch(wants(0), wants(3)), false);
});

Deno.test("players up to two clocks apart may be paired", () => {
  assert.equal(canMatch(wants(0, 0), wants(0, 0)), true);
  assert.equal(canMatch(wants(0, 0), wants(0, 1)), true);
  assert.equal(canMatch(wants(0, 0), wants(0, 2)), true);
  assert.equal(canMatch(wants(0, 3), wants(0, 1)), true);
  assert.equal(canMatch(wants(0, 0), wants(0, 3)), false);
});

Deno.test("both settings have to fit", () => {
  // The levels are close enough, but the clocks are not.
  assert.equal(canMatch(wants(1, 0), wants(2, 3)), false);
  // The clocks are close enough, but the levels are not.
  assert.equal(canMatch(wants(0, 1), wants(4, 2)), false);
});

Deno.test("a game is played at a level both players accept", () => {
  assert.equal(chooseComplexity(2, 2, low), 2);
  assert.equal(chooseComplexity(1, 3, low), 2);
  assert.equal(chooseComplexity(3, 1, low), 2);
});

Deno.test("a level one apart is decided by the coin", () => {
  assert.equal(chooseComplexity(1, 2, low), 1);
  assert.equal(chooseComplexity(1, 2, high), 2);
  assert.equal(chooseComplexity(3, 4, low), 3);
  assert.equal(chooseComplexity(3, 4, high), 4);
});

Deno.test("a game is played with a clock both players accept", () => {
  assert.equal(chooseTimeControl(1, 1, low), 1);
  assert.equal(chooseTimeControl(0, 2, low), 1);
  assert.equal(chooseTimeControl(2, 0, low), 1);
  assert.equal(chooseTimeControl(1, 3, low), 2);
});

Deno.test("a clock one apart is decided by the coin", () => {
  assert.equal(chooseTimeControl(0, 1, low), 0);
  assert.equal(chooseTimeControl(0, 1, high), 1);
  assert.equal(chooseTimeControl(2, 3, low), 2);
  assert.equal(chooseTimeControl(2, 3, high), 3);
});

Deno.test("the chosen level is always within one of both requests", () => {
  for (let a = minComplexity; a <= maxComplexity; a++) {
    for (let b = minComplexity; b <= maxComplexity; b++) {
      if (!canMatch(wants(a), wants(b))) continue;
      for (const random of [low, high]) {
        const level = chooseComplexity(a, b, random);
        assert.ok(
          Math.abs(level - a) <= 1 && Math.abs(level - b) <= 1,
          `${a} vs ${b} chose ${level}`,
        );
      }
    }
  }
});

Deno.test("the chosen clock is always within one of both requests", () => {
  for (let a = minTimeControl; a <= maxTimeControl; a++) {
    for (let b = minTimeControl; b <= maxTimeControl; b++) {
      if (!canMatch(wants(0, a), wants(0, b))) continue;
      for (const random of [low, high]) {
        const clock = chooseTimeControl(a, b, random);
        assert.ok(
          Math.abs(clock - a) <= 1 && Math.abs(clock - b) <= 1,
          `${a} vs ${b} chose ${clock}`,
        );
      }
    }
  }
});

Deno.test("a request outside the available levels is clamped", () => {
  assert.equal(clampComplexity(-3), minComplexity);
  assert.equal(clampComplexity(maxComplexity + 10), maxComplexity);
  assert.equal(clampComplexity(2.7), 2);
  assert.equal(clampComplexity(Number.NaN), minComplexity);
});
