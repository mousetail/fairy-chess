import type { ChessBoardState } from "../chess-board";
import pieceTypes from "../pieces";
import { getPromotionOptions } from "../pieces/promotion";

/**
 * The name the generated variant is registered under in Fairy-Stockfish.
 * Variants live in a global map, but every game gets a fresh engine, so a
 * single fixed name is enough.
 */
export const VARIANT_NAME = "fairychess";

/**
 * Maps a Betza movement string to the equivalent built-in Fairy-Stockfish piece
 * type. Movements that are not listed here are declared as custom pieces
 * instead. See the piece list in `Fairy-Stockfish/src/variants.ini`.
 */
const builtInTypes: Record<string, string> = {
  fmWfceF: "pawn",
  N: "knight",
  B: "bishop",
  R: "rook",
  Q: "queen",
  K: "king",
  W: "wazir",
  F: "fers",
  RN: "chancellor",
  BN: "archbishop",
  QN: "amazon",
  KN: "centaur",
};

/**
 * Builds a Fairy-Stockfish variant configuration describing exactly the piece
 * types in play, so that pieces which are not on the board are not defined.
 *
 * The symbols come from the game's resolved symbol map, which gives pieces
 * sharing a standard symbol distinct fallback letters.
 */
export function buildVariantIni(state: ChessBoardState): string {
  const lines = [`[${VARIANT_NAME}]`];
  let customIndex = 1;
  for (const [type, symbol] of state.symbols) {
    const letter = symbol.toLowerCase();
    const builtIn = builtInTypes[type.betza];
    lines.push(
      builtIn
        ? `${builtIn} = ${letter}`
        : `customPiece${customIndex++} = ${letter}:${type.betza}`,
    );
  }

  // Fairy-Stockfish only supports a single promotion set for the whole
  // variant, so the game's promotion options are mirrored here verbatim.
  const promotions = getPromotionOptions(state);
  if (promotions.length > 0) {
    const letters = promotions
      .map((type) => (state.symbols.get(type) ?? type.symbol).toLowerCase())
      .join("");
    lines.push(`promotionPieceTypes = ${letters}`);
  }

  // A wall can only ever reach the promotion rank by capturing, but when it
  // does it should promote like a pawn.
  const wallSymbol = state.symbols.get(pieceTypes.wall);
  if (wallSymbol) {
    const pawnSymbol = state.symbols.get(pieceTypes.pawn) ?? "p";
    lines.push(
      `promotionPawnTypes = ${pawnSymbol.toLowerCase()}${wallSymbol.toLowerCase()}`,
    );
  }

  return lines.join("\n");
}
