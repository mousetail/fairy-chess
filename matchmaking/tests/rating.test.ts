import assert from "node:assert/strict";
import {
  expectedScore,
  kFactor,
  resultScores,
  startingRating,
  updatedRatings,
} from "../rating.ts";

Deno.test("an even game is a coin toss", () => {
  assert.equal(expectedScore(1200, 1200), 0.5);
  assert.equal(expectedScore(1600, 1600), 0.5);
});

Deno.test("the stronger player is expected to win more often", () => {
  assert.ok(expectedScore(1400, 1200) > 0.5);
  assert.ok(expectedScore(1200, 1400) < 0.5);
  // The two expectations add up to one, however far apart the ratings are.
  assert.ok(
    Math.abs(expectedScore(2000, 1000) + expectedScore(1000, 2000) - 1) < 1e-9,
  );
});

Deno.test("a win against an equal gains half the k-factor", () => {
  const next = updatedRatings(1200, 1200, { white: 1, black: 0 });
  assert.equal(next.white, 1200 + kFactor / 2);
  assert.equal(next.black, 1200 - kFactor / 2);
});

Deno.test("beating a stronger player is worth more than beating a weaker one", () => {
  const upset = updatedRatings(1200, 1600, { white: 1, black: 0 });
  const expected = updatedRatings(1600, 1200, { white: 1, black: 0 });
  assert.ok(upset.white - 1200 > expected.white - 1600);
});

Deno.test("ratings are whole numbers that move the same distance both ways", () => {
  const next = updatedRatings(1213, 987, { white: 0, black: 1 });
  assert.ok(Number.isInteger(next.white));
  assert.ok(Number.isInteger(next.black));
});

Deno.test("a draw gives each side half a point", () => {
  assert.deepEqual(resultScores({ status: "draw", winner: "draw" }), {
    white: 0.5,
    black: 0.5,
  });
  assert.deepEqual(resultScores({ status: "checkmate", winner: "black" }), {
    white: 0,
    black: 1,
  });
});

Deno.test("a game that decided nothing changes no rating", () => {
  assert.equal(resultScores({ status: "abort", winner: null }), null);
});

Deno.test("the ratings everyone starts at are even", () => {
  const next = updatedRatings(startingRating, startingRating, {
    white: 0.5,
    black: 0.5,
  });
  assert.deepEqual(next, { white: startingRating, black: startingRating });
});
