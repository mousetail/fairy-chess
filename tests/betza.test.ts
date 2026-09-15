import assert from "node:assert/strict";
import { test } from "node:test";
import { betzaBehavior } from "../src/pieces/betza.ts";
import pieceTypes from "../src/pieces/piece_types/index.ts";
import type { PieceType } from "../src/pieces/piece_types/index.ts";
import { createEngine, type Engine } from "./engine.ts";
import { algebraicFromTile, buildState, fenFromPlacements } from "./helpers.ts";

/**
 * Symbols for the custom pieces in a batch. The letters used by the built-in
 * pieces the variant defines (`p` for the pawn, `k` for the king) are left out,
 * since a custom piece claiming one of them would displace the built-in.
 */
const SYMBOLS = "abcdefghijlmnoqrstuvwxyz".split("");

/** Boards the parser is checked against: empty, and with pieces to jump. */
const BLOCKER_SETS: string[][] = [
  [],
  ["d6", "f4", "b4", "d2", "e5", "c5", "e3", "c3"],
];

/**
 * Betza notations beyond the ones the game uses, to cover the parts of the
 * supported subset (hoppers, lame leapers, limited riders, direction
 * modifiers) that no current piece exercises.
 */
const EXTRA_BETZAS = [
  "pR",
  "pB",
  "gR",
  "gB",
  "pW2",
  "pF3",
  "nN",
  "nA",
  "nZ",
  "nD",
  "D",
  "A",
  "H",
  "L",
  "J",
  "G",
  "fsW",
  "fhW",
  "vW",
  "sW",
  "W2",
  "R3",
  "N2",
  "Q2",
  "mNcB",
  "fR",
  "fB",
  "lW",
  "rW",
  "bW",
];

function fakeType(betza: string, symbol: string): PieceType {
  return { betza, symbol } as PieceType;
}

/** The moves our parser generates for a lone piece on d4. */
function ourMoves(
  betza: string,
  color: "white" | "black",
  blockers: string[],
): string[] {
  const blockerType = fakeType("fmWfceF", "p");
  const state = buildState(
    [
      { type: fakeType(betza, "o"), color, square: "d4" },
      ...blockers.map((square) => ({
        type: blockerType,
        color: color === "white" ? ("black" as const) : ("white" as const),
        square,
      })),
    ],
    color,
  );
  const piece = state.pieces[0];
  return betzaBehavior(betza)(piece, state)
    .map((move) => `d4${algebraicFromTile(move.to)}`)
    .sort();
}

/**
 * Checks every notation against the engine, on an empty board and with pieces
 * to jump, for both colours. The notations are batched because a variant can
 * only define 25 custom pieces.
 */
async function assertBetzasMatchEngine(
  engine: Engine,
  prefix: string,
  betzas: string[],
): Promise<void> {
  for (let start = 0; start < betzas.length; start += SYMBOLS.length) {
    const batch = betzas.slice(start, start + SYMBOLS.length);
    const variantName = `${prefix}${start / SYMBOLS.length}`;
    const lines = [`[${variantName}]`, "pawn = p", "king = k"];
    batch.forEach((betza, index) => {
      lines.push(`customPiece${index + 1} = ${SYMBOLS[index]}:${betza}`);
    });
    const ini = lines.join("\n");

    for (const [index, betza] of batch.entries()) {
      const symbol = SYMBOLS[index];
      for (const color of ["white", "black"] as const) {
        for (const blockers of BLOCKER_SETS) {
          const fen = fenFromPlacements(
            [
              { symbol, color, square: "d4" },
              ...blockers.map((square) => ({
                symbol: "p",
                color:
                  color === "white" ? ("black" as const) : ("white" as const),
                square,
              })),
            ],
            color,
          );
          const theirs = await engine.perft(ini, variantName, fen);
          const ours = ourMoves(betza, color, blockers);
          assert.deepEqual(
            ours,
            theirs,
            `${betza} (${color}, ${blockers.length > 0 ? blockers.join(" ") : "empty board"})`,
          );
        }
      }
    }
  }
}

test("every piece type's Betza notation matches the engine", async () => {
  const engine = await createEngine();
  try {
    const betzas = [
      ...new Set(Object.values(pieceTypes).map((type) => type.betza)),
    ];
    await assertBetzasMatchEngine(engine, "piece", betzas);
  } finally {
    await engine.close();
  }
});

test("the Betza parser matches the engine across the supported subset", async () => {
  const engine = await createEngine();
  try {
    await assertBetzasMatchEngine(engine, "extra", EXTRA_BETZAS);
  } finally {
    await engine.close();
  }
});
