import classicPieces from "./classic.ts";
import combinationPieces from "./combinations.ts";
import fairyPieces from "./fairy.ts";
import kingPieces from "./kings.ts";
import pawnPieces from "./pawns.ts";

import type { PieceDiagram } from "../diagram.ts";
import type { LazyImage } from "../utils.ts";

export interface PieceType {
  image: LazyImage;
  /** Human-readable name shown in the piece info panel. */
  displayName: string;
  /** Other names this piece is known by, shown under the display name. */
  aliases?: string[];
  /** A short explanation of how the piece moves, shown under its diagram. */
  description: string;
  /** A hand-drawn picture of the piece's movement pattern. */
  diagram: PieceDiagram;

  /**
   * Movement rules in Betza notation. This is the single source of truth for
   * how the piece moves: {@link getBehavior} parses it for our own move
   * generation, and `ai/variant.ts` passes it to Fairy-Stockfish. See
   * https://www.gnu.org/software/xboard/Betza.html for the syntax and the list
   * of the engine's built-in piece types in `Fairy-Stockfish/src/variants.ini`
   * for the notation of each atom.
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
   * The squares this piece may move to, per colour, written in
   * Fairy-Stockfish's bitboard syntax (e.g. `a* b* c* d*` for the four left
   * files). Used to restrict our own move generation and to tell the engine
   * through `mobilityRegion*`.
   */
  mobilityRegion?: { white: string; black: string };
  /**
   * Whether this piece is royal: it is the piece its side is played around, so
   * it may never move into check and its capture ends the game. Exactly one
   * royal piece per colour is expected. `ai/variant.ts` declares it to the
   * engine as the variant's king.
   */
  royal?: boolean;
  /**
   * Whether this piece may castle with a rook like a king. Our move generation
   * adds the castling moves and `ai/variant.ts` enables castling for the engine.
   */
  canCastle?: boolean;
  /**
   * Whether this piece makes a two-square first move and may be captured en
   * passant, like a pawn. Our move generation adds the double step and
   * `ai/variant.ts` lists the piece in the engine's `enPassantTypes`.
   */
  canEnPassant?: boolean;
  /**
   * Whether this piece may be promoted to. Defaults to `"allow"`.
   *
   * `"deny"` keeps the piece out of the promotion options altogether (for
   * example, pawns and the royal king), while `"priority"` marks the piece as
   * the only promotion target whenever it is one of the pieces in play.
   */
  promotionAbility?: "allow" | "deny" | "priority";
  /**
   * Whether the piece promotes on the far rank like a pawn. Our move generation
   * attaches the promotion options to moves that reach the far rank, and
   * `ai/variant.ts` lists the piece in the engine's `promotionPawnTypes`.
   */
  promotesLikePawn?: boolean;
  /** Approximate point value, in pawns, used to compare material. */
  value: number;
}

const pieceTypes = {
  ...classicPieces,
  ...fairyPieces,
  ...combinationPieces,
  ...pawnPieces,
  ...kingPieces,
} satisfies Record<string, PieceType>;

export default pieceTypes;
