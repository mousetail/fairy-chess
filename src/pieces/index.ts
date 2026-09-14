import classicPieces from "./classic";
import combinationPieces from "./combinations";
import fairyPieces from "./fairy";

import type { Behavior, LazyImage } from "./utils";

export interface PieceType {
  image: LazyImage;
  canEnPassant?: boolean;

  behavior: Behavior;
  /**
   * Movement rules in Betza notation, used to describe the piece to the
   * Fairy-Stockfish engine. See https://www.gnu.org/software/xboard/Betza.html
   * for the syntax and the list of the engine's built-in piece types in
   * `Fairy-Stockfish/src/variants.ini` for the notation of each atom.
   */
  betza: string;
  /**
   * Standard single-character symbol for this piece, following the
   * Fairy-Stockfish conventions for its movement pattern. Symbols may collide
   * between piece types; {@link resolveSymbols} disambiguates them per game.
   */
  symbol: string;
  /** Symbols to fall back to when `symbol` is already taken by another piece in play. */
  fallbackSymbols?: string[];
  /**
   * Whether this piece may be promoted to. Defaults to `"allow"`.
   *
   * `"deny"` keeps the piece out of the promotion options altogether (for
   * example, pawns and the royal king), while `"priority"` marks the piece as
   * the only promotion target whenever it is one of the pieces in play.
   */
  promotionAbility?: "allow" | "deny" | "priority";
  /** Approximate point value, in pawns, used to compare material. */
  value: number;
}


const pieceTypes = {
  ...classicPieces,
  ...fairyPieces,
  ...combinationPieces,
} satisfies Record<string, PieceType>;

export default pieceTypes;
