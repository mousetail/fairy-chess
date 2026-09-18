import {
  cloneChessBoardState,
  type ChessBoardState,
  type Piece,
} from "./chess-board.ts";
import type { PieceType } from "./pieces/piece_types/index.ts";
import pieceTypes from "./pieces/piece_types/index.ts";
import type { Random } from "./random.ts";

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
  apply: (board: ChessBoardState, color: Color, random: Random) => boolean;
  /**
   * Whether the rule must be applied to every colour at once, so the two sides
   * can never end up with different results. The king variants set this: the
   * engine supports a single king per variant, so two different kings would make
   * the AI and the board disagree about which piece is royal.
   */
  symmetricOnly?: boolean;
  /**
   * Whether the rule swaps the royal piece. The king variants set this, because
   * full chaos only offers them occasionally so the classic king still shows up
   * in most games.
   */
  replacesKing?: boolean;
  /**
   * An extra point value the rule adds on top of the material it moves, for a
   * piece that is worth more in the starting position than its nominal value
   * suggests. The commoner corps is the example: a commoner counts as much as a
   * pawn, yet against a normal pawn corps it dominates, so its rule adds 3.
   */
  positionalValue?: number;
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
 * Builds a rule that swaps the king for a king variant.
 */
function kingRule(name: string, to: PieceType): ReplacementRule {
  return {
    name,
    complexity: 1,
    // Replaces both colors kings
    apply: (board, _color) => {
      const king = board.pieces.filter(
        (candidate) =>
          candidate.type === pieceTypes.king,
      );
      if (king.length === 0) return false;
      king.forEach((candidate) => {
        candidate.type = to;
      });
      return true;
    },
    symmetricOnly: true,
    replacesKing: true,
  };
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
 * Builds a rule that converts every remaining pawn of a colour into `to`.
 *
 * Used for a piece that arrives as a whole squad rather than as a single
 * specialist. Because the pawns are converted wholesale it deliberately ignores
 * {@link maxCopiesPerPiece}, the same way a piece of type `pawn` is exempt.
 */
function pawnSquadRule(
  name: string,
  to: PieceType,
  positionalValue = 0,
): ReplacementRule {
  return {
    name,
    complexity: 8,
    positionalValue,
    apply: (board, color) => {
      const pawns = board.pieces.filter(
        (candidate) =>
          candidate.color === color && candidate.type === pieceTypes.pawn,
      );
      if (pawns.length === 0) return false;
      for (const pawn of pawns) pawn.type = to;
      return true;
    },
  };
}

function everyOtherPawnRule(
  name: string,
  to: PieceType,
  positionalValue = 0,
): ReplacementRule {
  return {
    name,
    complexity: 4,
    positionalValue,
    apply: (board, color) => {
      let parity = Math.random() < 0.5 ? 0 : 1;
      const pawns = board.pieces.filter(
        (candidate) =>
          candidate.position.x % 2 === parity &&
          candidate.color === color &&
          candidate.type === pieceTypes.pawn,
      );
      if (pawns.length === 0) return false;
      for (const pawn of pawns) pawn.type = to;
      return true;
    },
  };
}

/**
 * Builds a rule that converts every pawn of a colour into one of two variants,
 * depending on which half of the board it starts on. Used for the jumping
 * pawns, whose two variants each stay on their own side of the centre line.
 *
 * Like {@link pawnSquadRule} it converts the whole corps, so it deliberately
 * ignores {@link maxCopiesPerPiece}.
 */
function pawnSplitRule(
  name: string,
  left: PieceType,
  right: PieceType,
): ReplacementRule {
  return {
    name,
    complexity: 8,
    apply: (board, color) => {
      const pawns = board.pieces.filter(
        (candidate) =>
          candidate.color === color && candidate.type === pieceTypes.pawn,
      );
      if (pawns.length === 0) return false;
      for (const pawn of pawns) {
        // A colour's left half is the board's right half for black, because the
        // board is mirrored between the two sides.
        const onLeft =
          color === "white" ? pawn.position.x < 4 : pawn.position.x >= 4;
        pawn.type = onLeft ? left : right;
      }
      return true;
    },
  };
}

/**
 * Builds a rule for a piece that arrives as a stacked double squad: it replaces
 * every pawn of a colour and adds a copy one square in front of each, so the
 * corps fills two whole rows. Used for weaker pawns.
 */
function pawnDoubleRowRule(name: string, to: PieceType): ReplacementRule {
  return {
    name,
    complexity: 16,
    apply: (board, color) => {
      const pawns = board.pieces.filter(
        (candidate) =>
          candidate.color === color && candidate.type === pieceTypes.pawn,
      );
      if (pawns.length === 0) return false;
      const forward = color === "white" ? 1 : -1;
      let nextId = board.pieces.reduce((max, p) => Math.max(max, p.id), -1) + 1;
      for (const pawn of pawns) {
        pawn.type = to;
        board.pieces.push({
          type: to,
          color,
          position: { x: pawn.position.x, y: pawn.position.y + forward },
          hasMoved: false,
          id: nextId++,
        });
      }
      return true;
    },
  };
}

/**
 * Every replacement currently available, each combining two single pieces into
 * the compound that moves like both, or replacing the king with a king variant.
 * The king variants are the only rules that use the king as a source, since they
 * take over its royal role rather than adding a specialist beside it.
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
  rule("Knight → Kning", pieceTypes.knight, pieceTypes.kning),
  rule("Knight → Camel", pieceTypes.knight, pieceTypes.camel),
  rule("Knight → Zebra", pieceTypes.knight, pieceTypes.zebra),
  rule("Knight → Unicorn", pieceTypes.knight, pieceTypes.unicorn),
  rule("Queen → Kniween", pieceTypes.queen, pieceTypes.kniween),
  rule("Queen → Wazir", pieceTypes.queen, pieceTypes.wazir),
  rule("Queen → Ferz", pieceTypes.queen, pieceTypes.ferz),
  rule("Queen → Pylon", pieceTypes.queen, pieceTypes.pylon),
  kingRule("King → Overlord", pieceTypes.overlord),
  kingRule("King → Paladin", pieceTypes.paladin),
  kingRule("King → Sun", pieceTypes.sun),
  pawnRule("c-pawn → Wall", 2, pieceTypes.wall),
  pawnRule("f-pawn → Wall", 5, pieceTypes.wall),
  pawnSquadRule("Pawns → Antipawns", pieceTypes.antipawn),
  everyOtherPawnRule("Pawns → Commoners", pieceTypes.commoner, 3),
  everyOtherPawnRule("Pawns -> Crows", pieceTypes.crow, 1),
  pawnSplitRule(
    "Pawns → Jumping Pawns",
    pieceTypes.jumpingPawnLeft,
    pieceTypes.jumpingPawnRight,
  ),
  pawnDoubleRowRule("Pawns → Spears", pieceTypes.spear),
  pawnSquadRule("Pawns → Sentries", pieceTypes.sentry),
  pawnDoubleRowRule("Pawns → Pseudocheckers", pieceTypes.pseudocheckers),
];

/** A setting on the home screen's chaos slider. */
export interface ChaosLevel {
  /** Label shown on the slider. */
  label: string;
  /** Total complexity of replacement rules to apply, or `Infinity` for full chaos. */
  budget: number;
  /**
   * Whether the two colours take turns instead of sharing one set of rules. The
   * asymmetric level alternates the sides and keeps the material balance near
   * level; see {@link applyBalanced}.
   */
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
 * The chance a chaos setup swaps the classic king for a king variant. The king
 * is a large change to the game, so most setups keep the classic one.
 */
const KING_VARIANT_CHANCE = 0.35;

/**
 * Applies replacement rules to `board` according to `level`.
 */
export function applyChaos(
  board: ChessBoardState,
  level: ChaosLevel,
  random: Random,
): void {
  if (level.budget <= 0) return;
  // One roll decides the whole game: the king variants are only offered a
  // quarter of the time, so the classic king still shows up in most games.
  const allowKingVariants = random.next() < KING_VARIANT_CHANCE;
  const rules = replacementRules.filter(
    (rule) => !rule.replacesKing || allowKingVariants,
  );
  if (level.asymmetric) {
    applyBalanced(board, rules, level.budget, random);
  } else {
    applyRules(board, rules, ["white", "black"], level.budget, random);
  }
}

/**
 * Spends `budget` complexity on random applicable rules, applying each chosen
 * rule to every colour in `colors`. Stops early when no rule can apply.
 */
function applyRules(
  board: ChessBoardState,
  rules: ReplacementRule[],
  colors: Color[],
  budget: number,
  random: Random,
): void {
  let spent = 0;
  while (spent < budget) {
    const applicable: [ChessBoardState, ReplacementRule][] = rules.flatMap((rule) =>
      applyToAll(rule, board, colors, random).map(
        (clone) => [clone, rule] satisfies [ChessBoardState, ReplacementRule]
      ),
    );
    if (applicable.length === 0) return;
    const [newBoard, chosen] = applicable[Math.floor(random.next() * applicable.length)];
    board.pieces = newBoard.pieces;
    spent += chosen.complexity;
  }
}

/**
 * Applies rules to the two colours in turn, spending `budget` complexity. Each
 * side may only take a rule that keeps the material balance near level
 */
function applyBalanced(
  board: ChessBoardState,
  rules: ReplacementRule[],
  budget: number,
  random: Random,
): void {
  const colors: Color[] = ["white", "black"];
  let turn = 0;
  let spent = 0;
  while (spent < budget) {
    let chosen: ChessBoardState | undefined;
    let rule: ReplacementRule | undefined;
    let chooser = 0;

    let balance = materialValue(board, "white") - materialValue(board, "black");
    // The side whose turn it is picks first, but the other side may move instead
    // when the first has no rule that keeps the balance.
    for (let offset = 0; offset < colors.length && !chosen; offset++) {
      const index = (turn + offset) % colors.length;
      const color = colors[index];
      const eligible = rules.flatMap(
        (rule) => {
          let clone = cloneChessBoardState(board);
          if (rule.apply(clone, color, random)) {
            let newBalance = materialValue(clone, "white") - materialValue(clone, "black");
            // Move towards a piece value balance
            if (balance === 0 || (balance > 0 && newBalance <= balance) || (balance < 0 && newBalance >= balance)) {
              return [[clone, rule] satisfies [ChessBoardState, ReplacementRule]];
            }
          }
          return [];
        },
      );
      if (eligible.length === 0) continue;
      [chosen, rule] = eligible[Math.floor(random.next() * eligible.length)];
      chooser = index;
    }
    if (!chosen || !rule) return;
    board.pieces = chosen.pieces;
    spent += rule.complexity;
    // The next side to pick is the one after whoever just moved.
    turn = chooser + 1;
  }
}

/** The total point value of a colour's pieces on the board. */
function materialValue(board: ChessBoardState, color: Color): number {
  return board.pieces
    .filter((piece) => piece.color === color)
    .reduce((total, piece) => total + piece.type.value, 0);
}
/**
 * Tests whether a rule can apply to every colour, without changing the board.
 * Applies to a clone so that symmetric rules are checked against the position
 * their own earlier applications would produce.
 */
function applyToAll(
  rule: ReplacementRule,
  board: ChessBoardState,
  colors: Color[],
  random: Random,
): ChessBoardState[] {
  const clone: ChessBoardState = cloneChessBoardState(board);
  const e = colors.reduce<boolean>(
    (e: boolean,
      color: Color) => e && rule.apply(clone, color, random),
    true,
  );
  return e ? [clone] : [];
}
