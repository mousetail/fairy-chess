import assert from "node:assert/strict";
import {
  canMatch,
  chooseComplexity,
  clampComplexity,
  maxComplexity,
  minComplexity,
  type Preference,
} from "../matchmaking.ts";

/** A preference, with the clock defaulted to the first time control. */
function wants(complexity: number, timeControl = 0): Preference {
  return { complexity, timeControl };
}

Deno.test("players within one level of each other may be paired", () => {
  assert.equal(canMatch(wants(0), wants(0)), true);
  assert.equal(canMatch(wants(1), wants(2)), true);
  assert.equal(canMatch(wants(2), wants(1)), true);
  assert.equal(canMatch(wants(0), wants(2)), false);
  assert.equal(canMatch(wants(2), wants(0)), false);
});

Deno.test("players who want different clocks are not paired", () => {
  assert.equal(canMatch(wants(0, 0), wants(0, 1)), false);
  assert.equal(canMatch(wants(0, 2), wants(0, 2)), true);
  // The clock is not negotiable the way the level is, so a level apart is not
  // enough on its own.
  assert.equal(canMatch(wants(1, 3), wants(2, 2)), false);
});

Deno.test("a game is played at a level both players accept", () => {
  assert.equal(chooseComplexity(2, 2), 2);
  assert.equal(chooseComplexity(1, 3), 2);
  assert.equal(chooseComplexity(3, 1), 2);
  // A tie goes to the less chaotic level.
  assert.equal(chooseComplexity(1, 2), 1);
  assert.equal(chooseComplexity(3, 4), 3);
});

Deno.test("the chosen level is always within one of both requests", () => {
  for (let a = minComplexity; a <= maxComplexity; a++) {
    for (let b = minComplexity; b <= maxComplexity; b++) {
      if (!canMatch(wants(a), wants(b))) continue;
      const level = chooseComplexity(a, b);
      assert.ok(
        Math.abs(level - a) <= 1 && Math.abs(level - b) <= 1,
        `${a} vs ${b} chose ${level}`,
      );
    }
  }
});

Deno.test("a request outside the available levels is clamped", () => {
  assert.equal(clampComplexity(-3), minComplexity);
  assert.equal(clampComplexity(maxComplexity + 10), maxComplexity);
  assert.equal(clampComplexity(2.7), 2);
  assert.equal(clampComplexity(Number.NaN), minComplexity);
});
