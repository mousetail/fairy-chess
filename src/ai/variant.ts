import type { ChessBoardState } from "../chess-board";
import pieceTypes, { type PieceType } from "../pieces/piece_types";
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
 * The squares each colour's copy of a piece may move to, for pieces whose
 * movement depends on which half of the board they stand on. The jumping pawns
 * are split into a left and a right variant so that each has a fixed diagonal
 * towards the centre; the region keeps each variant on its own side of the
 * centre line. The regions are written in Fairy-Stockfish's bitboard syntax,
 * where `a*` is a whole file.
 */
const mobilityRegions = new Map<PieceType, { white: string; black: string }>([
  [pieceTypes.jumpingPawnLeft, { white: "a* b* c* d*", black: "e* f* g* h*" }],
  [pieceTypes.jumpingPawnRight, { white: "e* f* g* h*", black: "a* b* c* d*" }],
]);

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
    if (builtIn) {
      lines.push(`${builtIn} = ${letter}`);
      continue;
    }
    const index = customIndex++;
    lines.push(`customPiece${index} = ${letter}:${type.betza}`);
    const region = mobilityRegions.get(type);
    if (region) {
      lines.push(`mobilityRegionWhiteCustomPiece${index} = ${region.white}`);
      lines.push(`mobilityRegionBlackCustomPiece${index} = ${region.black}`);
    }
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

  // Pieces that promote like a pawn (the pawn itself, the wall and the pawn
  // variants) must be listed so the engine lets them promote on the far rank.
  // The pawn is always listed first, as it is the main promotion pawn.
  const extraPromoters = [...state.symbols].filter(
    ([type]) => type.promotesLikePawn && type !== pieceTypes.pawn,
  );
  if (extraPromoters.length > 0) {
    const pawnSymbol = state.symbols.get(pieceTypes.pawn) ?? "p";
    const symbols = [pawnSymbol, ...extraPromoters.map(([, symbol]) => symbol)];
    lines.push(
      `promotionPawnTypes = ${symbols.map((s) => s.toLowerCase()).join("")}`,
    );
  }

  return lines.join("\n");
}
