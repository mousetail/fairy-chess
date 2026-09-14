import {
  cloneChessBoardState,
  type ChessBoardState,
  type Piece,
} from "./chess-board";
import type { PieceType } from "./pieces";
import pieceTypes from "./pieces";

type Color = Piece["color"];

/**
 * A rule that swaps a piece in the starting position for a fairy piece.
 *
 * Rules are applied at game setup, before the symbols in play are resolved, so
 * the resulting position determines which piece types are on the board.
 */
export interface ReplacementRule {
  /** Human-readable name, used for debugging and to identify the rule. */
  name: string;
  /** How much of the chaos budget this rule consumes. Usually the number of pieces it replaces. */
  complexity: number;
  /**
   * Replaces one piece belonging to `color` on `board`, mutating it in place.
   * Returns false when the board holds no piece this rule can replace.
   */
  apply: (board: ChessBoardState, color: Color) => boolean;
}

/**
 * The most copies of a single non-pawn piece type a colour may field after the
 * setup. Both colours may each have this many of the same piece.
 */
export const maxCopiesPerPiece = 2;

/**
 * Builds the `apply` function for a rule that swaps the first `from` piece for
 * `to`. Refuses to apply when `color` would end up with more than
 * {@link maxCopiesPerPiece} pieces of type `to`.
 */
function replace(from: PieceType, to: PieceType): ReplacementRule["apply"] {
  return (board, color) => {
    const pieces = board.pieces.filter(
      (candidate) => candidate.color === color && candidate.type === from,
    );
    if (pieces.length === 0) return false;
    const copies = board.pieces.filter(
      (candidate) => candidate.color === color && candidate.type === to,
    ).length;
    if (to !== pieceTypes.pawn && copies >= maxCopiesPerPiece) {
      return false;
    }
    pieces[Math.floor(Math.random() * pieces.length)].type = to;
    return true;
  };
}

/** Builds a complexity-1 rule that swaps one `from` piece for `to`. */
function rule(name: string, from: PieceType, to: PieceType): ReplacementRule {
  return { name, complexity: 1, apply: replace(from, to) };
}

/**
 * Builds a complexity-1 rule that swaps the pawn on `file` for `to`. Used for
 * pieces that replace a specific pawn rather than the first one available.
 */
function pawnRule(name: string, file: number, to: PieceType): ReplacementRule {
  return {
    name,
    complexity: 1,
    apply: (board, color) => {
      const pawn = board.pieces.find(
        (candidate) =>
          candidate.color === color &&
          candidate.type === pieceTypes.pawn &&
          candidate.position.x === file,
      );
      if (!pawn) return false;
      const copies = board.pieces.filter(
        (candidate) => candidate.color === color && candidate.type === to,
      ).length;
      if (copies >= maxCopiesPerPiece) return false;
      pawn.type = to;
      return true;
    },
  };
}

/**
 * Every replacement currently available, each combining two single pieces into
 * the compound that moves like both. The king is never used as a source, since
 * it carries the check and castling rules.
 */
export const replacementRules: ReplacementRule[] = [
  rule("Rook → Ring", pieceTypes.rook, pieceTypes.ring),
  rule("Rook → Knook", pieceTypes.rook, pieceTypes.knook),
  rule("Rook → Wazir", pieceTypes.rook, pieceTypes.wazir),
  rule("Bishop → Knishop", pieceTypes.bishop, pieceTypes.knishop),
  rule("Bishop → Bing", pieceTypes.bishop, pieceTypes.bing),
  rule("Bishop → Ferz", pieceTypes.bishop, pieceTypes.ferz),
  rule("Knight → Knook", pieceTypes.knight, pieceTypes.knook),
  rule("Knight → Knishop", pieceTypes.knight, pieceTypes.knishop),
  rule("Knight → Kniween", pieceTypes.knight, pieceTypes.kniween),
  rule("Knight → Kning", pieceTypes.knight, pieceTypes.kning),
  rule("Knight → Camel", pieceTypes.knight, pieceTypes.camel),
  rule("Knight → Zebra", pieceTypes.knight, pieceTypes.zebra),
  rule("Knight → Unicorn", pieceTypes.knight, pieceTypes.unicorn),
  rule("Queen → Kniween", pieceTypes.queen, pieceTypes.kniween),
  rule("Queen → Wazir", pieceTypes.queen, pieceTypes.wazir),
  rule("Queen → Ferz", pieceTypes.queen, pieceTypes.ferz),
  rule("Queen → Pylon", pieceTypes.queen, pieceTypes.pylon),
  pawnRule("c-pawn → Wall", 2, pieceTypes.wall),
  pawnRule("f-pawn → Wall", 5, pieceTypes.wall),
];

/** A setting on the home screen's chaos slider. */
export interface ChaosLevel {
  /** Label shown on the slider. */
  label: string;
  /** Total complexity of replacement rules to apply, or `Infinity` for full chaos. */
  budget: number;
  /** Whether each colour picks its own rules instead of sharing one set. */
  asymmetric: boolean;
}

/**
 * The chaos levels, in slider order. The labels are the single source of truth
 * used by the home screen.
 */
export const chaosLevels: ChaosLevel[] = [
  { label: "normal chess", budget: 0, asymmetric: false },
  { label: "one fairy piece", budget: 1, asymmetric: false },
  { label: "several fairy pieces", budget: 3, asymmetric: false },
  { label: "full random symetric", budget: Infinity, asymmetric: false },
  { label: "full random asymetric", budget: Infinity, asymmetric: true },
];

/**
 * Applies replacement rules to `board` according to `level`.
 *
 * Symmetric levels apply the same rule to both colours, which keeps the setup
 * mirrored. Asymmetric levels choose an independent set for each colour.
 */
export function applyChaos(
  board: ChessBoardState,
  level: ChaosLevel,
  random: () => number = Math.random,
): void {
  if (level.budget <= 0) return;
  if (level.asymmetric) {
    applyRules(board, ["white"], level.budget, random);
    applyRules(board, ["black"], level.budget, random);
  } else {
    applyRules(board, ["white", "black"], level.budget, random);
  }
}

/**
 * Spends `budget` complexity on random applicable rules, applying each chosen
 * rule to every colour in `colors`. Stops early when no rule can apply.
 */
function applyRules(
  board: ChessBoardState,
  colors: Color[],
  budget: number,
  random: () => number,
): void {
  const available = [...replacementRules];
  let spent = 0;
  while (spent < budget) {
    const applicable = available.filter((rule) =>
      canApplyToAll(rule, board, colors),
    );
    if (applicable.length === 0) return;
    const chosen = applicable[Math.floor(random() * applicable.length)];
    available.splice(available.indexOf(chosen), 1);
    for (const color of colors) chosen.apply(board, color);
    spent += chosen.complexity;
  }
}

/**
 * Tests whether a rule can apply to every colour, without changing the board.
 * Applies to a clone so that symmetric rules are checked against the position
 * their own earlier applications would produce.
 */
function canApplyToAll(
  rule: ReplacementRule,
  board: ChessBoardState,
  colors: Color[],
): boolean {
  const clone = cloneChessBoardState(board);
  return colors.every((color) => rule.apply(clone, color));
}
