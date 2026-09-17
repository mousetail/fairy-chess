import assert from "node:assert/strict";
import { movesToPgn, parsePgn } from "../pgn.ts";

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

Deno.test("a move list survives being written and read back", () => {
  const moves = [
    { color: "white" as const, pgn: "e4" },
    { color: "black" as const, pgn: "e5" },
    { color: "white" as const, pgn: "Nf3" },
    { color: "black" as const, pgn: "O-O-O" },
  ];
  assert.deepEqual(parsePgn(movesToPgn(moves)), moves);
});

Deno.test("an empty move list reads back as nothing", () => {
  assert.deepEqual(parsePgn(""), []);
});
