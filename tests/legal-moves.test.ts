import assert from "node:assert/strict";
import { test } from "node:test";
import { boardStateToFen } from "../src/ai/fen.ts";
import { buildVariantIni, VARIANT_NAME } from "../src/ai/variant.ts";
import {
  getValidMoves,
  type ChessBoardState,
  type TaggedMove,
} from "../src/chess-board.ts";
import { resolveSymbols } from "../src/chess-game.ts";
import pieceTypes from "../src/pieces/piece_types/index.ts";
import type { PieceType } from "../src/pieces/piece_types/index.ts";
import { createEngine, type Engine } from "./engine.ts";
import {
  algebraicFromTile,
  buildState,
  tileFromAlgebraic,
  type Placement,
} from "./helpers.ts";

const BLOCKERS = ["d6", "f4", "b4", "d2", "e5", "c5", "e3", "c3"];

/** A variant that defines every piece type, so any position can be tested. */
function allTypesVariant(): {
  ini: string;
  symbols: Map<PieceType, string>;
} {
  const symbols = resolveSymbols(Object.values(pieceTypes));
  const state: ChessBoardState = {
    pieces: [],
    turn: "white",
    halfTurnNumber: 0,
    lastMove: undefined,
    symbols,
  };
  return { ini: buildVariantIni(state), symbols };
}

/** Every legal move of the side to move, as `e2e4` (with a promotion letter). */
function ourLegalMoves(state: ChessBoardState): string[] {
  const moves: string[] = [];
  for (const piece of state.pieces.filter((p) => p.color === state.turn)) {
    for (const move of getValidMoves(piece, state)) {
      const from = algebraicFromTile(piece.position);
      const to = algebraicFromTile(move.to);
      if (move.promotion?.state === "pending") {
        for (const option of move.promotion.options) {
          const symbol = state.symbols.get(option) ?? option.symbol;
          moves.push(`${from}${to}${symbol.toLowerCase()}`);
        }
      } else {
        moves.push(`${from}${to}`);
      }
    }
  }
  return [...new Set(moves)].sort();
}

async function assertPositionMatchesEngine(
  engine: Engine,
  ini: string,
  state: ChessBoardState,
  label: string,
): Promise<void> {
  const fen = boardStateToFen(state, 1);
  const theirs = await engine.perft(ini, VARIANT_NAME, fen);
  const ours = ourLegalMoves(state);
  assert.deepEqual(ours, theirs, `${label} (${fen})`);
}

test("every piece type's legal moves match the engine", async () => {
  const engine = await createEngine();
  try {
    const { ini, symbols } = allTypesVariant();
    for (const type of Object.values(pieceTypes) as PieceType[]) {
      const placements: Placement[] = [
        { type, color: "white", square: "d4" },
        { type: pieceTypes.king, color: "black", square: "a8" },
      ];
      // A king-like piece is its own royal piece; everything else needs one.
      if (!type.canCastle) {
        placements.push({ type: pieceTypes.king, color: "white", square: "h1" });
      }
      for (const square of BLOCKERS) {
        placements.push({ type: pieceTypes.pawn, color: "black", square });
      }
      const state = buildState(placements, "white", { symbols });
      await assertPositionMatchesEngine(engine, ini, state, type.displayName);
    }
  } finally {
    await engine.close();
  }
});

test("castling matches the engine", async () => {
  const engine = await createEngine();
  try {
    const { ini, symbols } = allTypesVariant();
    const state = buildState(
      [
        { type: pieceTypes.king, color: "white", square: "e1" },
        { type: pieceTypes.rook, color: "white", square: "h1" },
        { type: pieceTypes.rook, color: "white", square: "a1" },
        { type: pieceTypes.king, color: "black", square: "e8" },
      ],
      "white",
      { symbols },
    );
    await assertPositionMatchesEngine(engine, ini, state, "castling");
  } finally {
    await engine.close();
  }
});

test("castling out of and through check matches the engine", async () => {
  const engine = await createEngine();
  try {
    const { ini, symbols } = allTypesVariant();
    // The black rook attacks f1, so the king may not castle through it; the
    // black bishop attacks e1, so it may not castle out of check either.
    const state = buildState(
      [
        { type: pieceTypes.king, color: "white", square: "e1" },
        { type: pieceTypes.rook, color: "white", square: "h1" },
        { type: pieceTypes.rook, color: "white", square: "a1" },
        { type: pieceTypes.king, color: "black", square: "a8" },
        { type: pieceTypes.rook, color: "black", square: "f8" },
        { type: pieceTypes.bishop, color: "black", square: "b4" },
      ],
      "white",
      { symbols },
    );
    await assertPositionMatchesEngine(engine, ini, state, "castling through check");
  } finally {
    await engine.close();
  }
});

test("en passant matches the engine", async () => {
  const engine = await createEngine();
  try {
    const { ini, symbols } = allTypesVariant();
    const lastMove: TaggedMove = {
      piece: {
        type: pieceTypes.pawn,
        color: "black",
        position: tileFromAlgebraic("d5"),
        hasMoved: true,
        id: 99,
      },
      from: tileFromAlgebraic("d7"),
      to: tileFromAlgebraic("d5"),
      type: "move",
      passedTilesForEnPassant: [tileFromAlgebraic("d6")],
    };
    const state = buildState(
      [
        { type: pieceTypes.pawn, color: "white", square: "e5" },
        { type: pieceTypes.pawn, color: "black", square: "d5" },
        { type: pieceTypes.king, color: "white", square: "h1" },
        { type: pieceTypes.king, color: "black", square: "a8" },
      ],
      "white",
      { symbols, lastMove },
    );
    await assertPositionMatchesEngine(engine, ini, state, "en passant");
  } finally {
    await engine.close();
  }
});

test("promotion matches the engine", async () => {
  const engine = await createEngine();
  try {
    const { ini, symbols } = allTypesVariant();
    const state = buildState(
      [
        { type: pieceTypes.pawn, color: "white", square: "d7" },
        { type: pieceTypes.rook, color: "black", square: "c8" },
        { type: pieceTypes.king, color: "white", square: "h1" },
        { type: pieceTypes.king, color: "black", square: "a8" },
      ],
      "white",
      { symbols },
    );
    await assertPositionMatchesEngine(engine, ini, state, "promotion");
  } finally {
    await engine.close();
  }
});

test("mobility regions match the engine", async () => {
  const engine = await createEngine();
  try {
    const { ini, symbols } = allTypesVariant();
    const state = buildState(
      [
        { type: pieceTypes.jumpingPawnLeft, color: "white", square: "b2" },
        { type: pieceTypes.jumpingPawnRight, color: "white", square: "g2" },
        { type: pieceTypes.jumpingPawnLeft, color: "black", square: "g7" },
        { type: pieceTypes.jumpingPawnRight, color: "black", square: "b7" },
        { type: pieceTypes.king, color: "white", square: "e1" },
        { type: pieceTypes.king, color: "black", square: "e8" },
      ],
      "white",
      { symbols },
    );
    await assertPositionMatchesEngine(engine, ini, state, "mobility regions");
  } finally {
    await engine.close();
  }
});
