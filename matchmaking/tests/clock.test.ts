import assert from "node:assert/strict";
import { flagGraceMs, GameClock } from "../clock.ts";
import { describeTimeControl } from "../lobby.ts";

/** The 1+2 clock the tests use: a minute each, two seconds a move. */
function clock(): GameClock {
  return new GameClock(describeTimeControl(0));
}

Deno.test("a clock starts full, with nothing running", () => {
  const game = clock();
  assert.equal(game.runningColor, null);
  assert.equal(game.hasMoved("white"), false);
  assert.deepEqual(game.snapshot(0), {
    white: 60_000,
    black: 60_000,
    running: null,
  });
});

Deno.test("the first move of each side is free", () => {
  const game = clock();
  game.afterMove("white", "black", 0);
  // White has moved, so white may be timed; black has not, so nothing runs.
  assert.equal(game.hasMoved("white"), true);
  assert.equal(game.runningColor, null);
  assert.deepEqual(game.snapshot(0), {
    white: 62_000,
    black: 60_000,
    running: null,
  });

  game.afterMove("black", "white", 0);
  assert.equal(game.runningColor, "white");
  assert.deepEqual(game.snapshot(0), {
    white: 62_000,
    black: 62_000,
    running: "white",
  });
});

Deno.test("the clock runs for the side to move, and the increment is added", () => {
  const game = clock();
  game.afterMove("white", "black", 0);
  game.afterMove("black", "white", 0);

  // Ten seconds pass, then white moves: 62 - 10 + 2 = 54.
  game.afterMove("white", "black", 10_000);
  assert.deepEqual(game.snapshot(10_000), {
    white: 54_000,
    black: 62_000,
    running: "black",
  });
});

Deno.test("only the running clock can run out, and only past the grace", () => {
  const game = clock();
  game.afterMove("white", "black", 0);
  game.afterMove("black", "white", 0);

  // White has 62 seconds, and the grace is a second more.
  assert.equal(game.flagged(61_999), null);
  assert.equal(game.flagged(62_000), null);
  assert.equal(game.flagged(62_000 + flagGraceMs), null);
  assert.equal(game.flagged(62_000 + flagGraceMs + 1), "white");
});

Deno.test("a clock that is not running cannot run out", () => {
  const game = clock();
  // Nothing has moved, so nothing is timed however long the game sits there.
  assert.equal(game.flagged(10_000_000), null);
});

Deno.test("the times shown never go below zero", () => {
  const game = clock();
  game.afterMove("white", "black", 0);
  game.afterMove("black", "white", 0);
  assert.deepEqual(game.snapshot(1_000_000), {
    white: 0,
    black: 62_000,
    running: "white",
  });
});
