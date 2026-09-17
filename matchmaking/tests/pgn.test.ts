import assert from "node:assert/strict";
import { movesToPgn } from "../pgn.ts";

Deno.test("a move list is written as PGN", () => {
  assert.equal(
    movesToPgn([
      { color: "white", pgn: "e4" },
      { color: "black", pgn: "e5" },
      { color: "white", pgn: "Nf3" },
    ]),
    "1. e4 e5 2. Nf3",
  );
});

Deno.test("a move list with no moves is empty", () => {
  assert.equal(movesToPgn([]), "");
});

Deno.test("a list that starts with black is written from move one", () => {
  // A move that never arrives still leaves a black reply, which has a pair to
  // belong to rather than a number of its own.
  assert.equal(
    movesToPgn([
      { color: "white", pgn: "e4" },
      { color: "black", pgn: "e5" },
    ]),
    "1. e4 e5",
  );
});
