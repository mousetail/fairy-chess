import assert from "node:assert/strict";
import { test } from "node:test";
import type { Color } from "../src/online/protocol.ts";
import {
  describeResult,
  isDrawn,
  type GameEndStatus,
} from "../src/chess-screen/result-text.ts";

test("every way a game can end is named under the score", () => {
  const cases: [GameEndStatus, Color | null, string | null][] = [
    ["checkmate", "white", "Checkmate"],
    ["checkmate", "black", "Checkmate"],
    ["stalemate", null, "Stalemate"],
    ["repetition", null, "3-fold repetition"],
    ["draw", null, "Draw by agreement"],
    ["resign", "white", "White resigned"],
    ["resign", "black", "Black resigned"],
    ["timeout", "white", "White ran out of time"],
    ["timeout", "black", "Black ran out of time"],
    // A game called off says nothing beyond the score it leaves.
    ["abort", null, null],
  ];

  for (const [status, loser, reason] of cases) {
    assert.equal(describeResult(status, loser), reason, `${status}, ${loser}`);
  }
});

test("only a level game reads as level", () => {
  const drawn: GameEndStatus[] = ["stalemate", "repetition", "draw"];
  const won: GameEndStatus[] = [
    "checkmate",
    "resign",
    "timeout",
    "abort",
  ];

  for (const status of drawn) assert.equal(isDrawn(status), true, status);
  for (const status of won) assert.equal(isDrawn(status), false, status);
});
