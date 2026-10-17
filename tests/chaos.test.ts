import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChessBoardState, Piece } from "../src/chess-board.ts";
import { ChessGame } from "../src/chess-game.ts";
import {
  chaosLevels,
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
