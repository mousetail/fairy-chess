import type { ChessBoardState } from "../chess-board.ts";
import pieceTypes from "../pieces/piece_types/index.ts";
import { getPromotionOptions } from "../pieces/promotion.ts";

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
export const builtInTypes: Record<string, string> = {
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Builds a Fairy-Stockfish variant configuration describing exactly the piece
 * types in play, so that pieces which are not on the board are not defined.
 *
 * The symbols come from the game's resolved symbol map, which gives pieces
 * sharing a standard symbol distinct fallback letters. Every rule that is not
 * part of the Betza notation (the movement area, castling, en passant and
 * promotion) is read from the piece definitions, so the engine and our own move
 * generation always agree.
 */
export function buildVariantIni(state: ChessBoardState): string {
  const lines = [`[${VARIANT_NAME}]`];
  let customIndex = 1;
  for (const [type, symbol] of state.symbols) {
    const letter = symbol.toLowerCase();
    const builtIn = builtInTypes[type.betza];
    let pieceName: string;
    if (builtIn) {
      lines.push(`${builtIn} = ${letter}`);
      pieceName = capitalize(builtIn);
    } else {
      const index = customIndex++;
      lines.push(`customPiece${index} = ${letter}:${type.betza}`);
      pieceName = `CustomPiece${index}`;
    }
    if (type.mobilityRegion) {
      lines.push(
        `mobilityRegionWhite${pieceName} = ${type.mobilityRegion.white}`,
      );
      lines.push(
        `mobilityRegionBlack${pieceName} = ${type.mobilityRegion.black}`,
      );
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
  // The pawn is listed first when it is in play, as it is the main promotion
  // pawn.
  const promoters = [...state.symbols].filter(([type]) => type.promotesLikePawn);
  const pawn = promoters.find(([type]) => type === pieceTypes.pawn);
  const extraPromoters = promoters.filter(([type]) => type !== pieceTypes.pawn);
  if (extraPromoters.length > 0) {
    const ordered = pawn ? [pawn, ...extraPromoters] : extraPromoters;
    lines.push(
      `promotionPawnTypes = ${ordered
        .map(([, symbol]) => symbol.toLowerCase())
        .join("")}`,
    );
  }

  // Pieces that may be captured en passant. The engine otherwise defaults to
  // the pawn, which is only correct when the pawn is in play.
  const enPassantTypes = [...state.symbols].filter(
    ([type]) => type.canEnPassant,
  );
  if (enPassantTypes.length > 0) {
    lines.push(
      `enPassantTypes = ${enPassantTypes
        .map(([, symbol]) => symbol.toLowerCase())
        .join("")}`,
    );
  }

  // Castling is only possible when a piece that may castle is in play.
  const canCastle = [...state.symbols.keys()].some((type) => type.canCastle);
  lines.push(`castling = ${canCastle}`);

  return lines.join("\n");
}
