import {
  type ChessBoardState,
  type SpecialMovement,
} from "../../chess-board";
import type { Tile } from "../../chess-tile";
import { type PieceType } from ".";
import { getPromotionOptions } from "../promotion";
import {
  getPieceImageAsync,
  jumpBehavior,
  normalizeColor,
  type Behavior,
} from "../utils";

function inBounds(pos: Tile): boolean {
  return pos.x >= 0 && pos.x < 8 && pos.y >= 0 && pos.y < 8;
}

/**
 * Marks every move that lands on the far rank as a pending promotion. Called
 * from inside a `normalizeColor` behavior, so `y === 7` is always the promoting
 * rank from the moving side's point of view.
 */
function withPromotion(
  moves: SpecialMovement[],
  state: ChessBoardState,
): SpecialMovement[] {
  const options = getPromotionOptions(state);
  return moves.map((move) =>
    move.to.y === 7
      ? { ...move, promotion: { state: "pending", options } }
      : move,
  );
}

/**
 * Moves one square diagonally but captures straight forward, so it can only
 * advance by capturing. It promotes like a pawn.
 */
const antipawnBehavior = normalizeColor(
  (position, isOccupied, isOccupiedByEnemy, state) => {
    const moves: SpecialMovement[] = [];
    for (const dx of [-1, 1]) {
      for (const dy of [-1, 1]) {
        const to = { x: position.x + dx, y: position.y + dy };
        if (inBounds(to) && !isOccupied(to)) moves.push({ to, type: "move" });
      }
    }
    const forward = { x: position.x, y: position.y + 1 };
    if (inBounds(forward) && isOccupiedByEnemy(forward)) {
      moves.push({ to: forward, type: "capture" });
    }
    return withPromotion(moves, state);
  },
);

/**
 * Moves up to two squares forward and captures up to two squares diagonally
 * forward. Neither move may jump, so the second square is only reachable when
 * the first is empty.
 */
const commonerBehavior = normalizeColor(
  (position, isOccupied, isOccupiedByEnemy, state) => {
    const moves: SpecialMovement[] = [];
    const forward1 = { x: position.x, y: position.y + 1 };
    const forward2 = { x: position.x, y: position.y + 2 };
    if (inBounds(forward1) && !isOccupied(forward1)) {
      moves.push({ to: forward1, type: "move" });
      if (inBounds(forward2) && !isOccupied(forward2)) {
        moves.push({ to: forward2, type: "move" });
      }
    }
    for (const dx of [-1, 1]) {
      const capture1 = { x: position.x + dx, y: position.y + 1 };
      const capture2 = { x: position.x + dx * 2, y: position.y + 2 };
      if (inBounds(capture1) && isOccupiedByEnemy(capture1)) {
        moves.push({ to: capture1, type: "capture" });
      }
      if (
        inBounds(capture1) &&
        inBounds(capture2) &&
        !isOccupied(capture1) &&
        isOccupiedByEnemy(capture2)
      ) {
        moves.push({ to: capture2, type: "capture" });
      }
    }
    return withPromotion(moves, state);
  },
);

/**
 * The jumping pawn's backwards capture: it slides straight back and captures
 * the first enemy piece it meets, like a rook that may only capture backwards.
 */
function backwardCaptures(
  position: Tile,
  isOccupied: (tile: Tile) => boolean,
  isOccupiedByEnemy: (tile: Tile) => boolean,
): SpecialMovement[] {
  const moves: SpecialMovement[] = [];
  for (let y = position.y - 1; y >= 0; y--) {
    const to = { x: position.x, y };
    if (!isOccupied(to)) continue;
    if (isOccupiedByEnemy(to)) moves.push({ to, type: "capture" });
    break;
  }
  return moves;
}

/**
 * The left jumping pawn moves forward or one square diagonally towards the
 * centre line, and captures backwards any distance. It is confined to the left
 * half of the board (see `mobilityRegion` in `variant.ts`), so it never crosses
 * the centre.
 */
const jumpingPawnLeftBehavior = normalizeColor(
  (position, isOccupied, isOccupiedByEnemy, state) => {
    const moves: SpecialMovement[] = [];
    const forward = { x: position.x, y: position.y + 1 };
    if (inBounds(forward) && !isOccupied(forward)) {
      moves.push({ to: forward, type: "move" });
    }
    const diagonal = { x: position.x + 1, y: position.y + 1 };
    if (position.x < 3 && inBounds(diagonal) && !isOccupied(diagonal)) {
      moves.push({ to: diagonal, type: "move" });
    }
    moves.push(...backwardCaptures(position, isOccupied, isOccupiedByEnemy));
    return withPromotion(moves, state);
  },
);

/** The right jumping pawn, the mirror image of {@link jumpingPawnLeftBehavior}. */
const jumpingPawnRightBehavior = normalizeColor(
  (position, isOccupied, isOccupiedByEnemy, state) => {
    const moves: SpecialMovement[] = [];
    const forward = { x: position.x, y: position.y + 1 };
    if (inBounds(forward) && !isOccupied(forward)) {
      moves.push({ to: forward, type: "move" });
    }
    const diagonal = { x: position.x - 1, y: position.y + 1 };
    if (position.x > 4 && inBounds(diagonal) && !isOccupied(diagonal)) {
      moves.push({ to: diagonal, type: "move" });
    }
    moves.push(...backwardCaptures(position, isOccupied, isOccupiedByEnemy));
    return withPromotion(moves, state);
  },
);

/** Moves and captures one square forward, and nothing else. */
const torpedoBehavior = normalizeColor(
  (position, isOccupied, isOccupiedByEnemy, state) => {
    const to = { x: position.x, y: position.y + 1 };
    if (!inBounds(to)) return [];
    if (isOccupiedByEnemy(to)) {
      return withPromotion([{ to, type: "capture" }], state);
    }
    if (!isOccupied(to)) return withPromotion([{ to, type: "move" }], state);
    return [];
  },
);

/** Moves one square forward and captures one square sideways. */
const sentryBehavior = normalizeColor(
  (position, isOccupied, isOccupiedByEnemy, state) => {
    const moves: SpecialMovement[] = [];
    const forward = { x: position.x, y: position.y + 1 };
    if (inBounds(forward) && !isOccupied(forward)) {
      moves.push({ to: forward, type: "move" });
    }
    for (const dx of [-1, 1]) {
      const to = { x: position.x + dx, y: position.y };
      if (inBounds(to) && isOccupiedByEnemy(to)) {
        moves.push({ to, type: "capture" });
      }
    }
    return withPromotion(moves, state);
  },
);

const kingDirections = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

const kingJumps = jumpBehavior(kingDirections);

/**
 * Captures an adjacent enemy piece like a king, but never moves. A capture that
 * lands on the far rank promotes, so a wall that fights its way to the top can
 * still become a real piece.
 */
const wallBehavior: Behavior = (piece, state) => {
  const captures = kingJumps(piece, state).filter(
    (move) => move.type === "capture",
  );
  const lastRank = piece.color === "white" ? 7 : 0;
  const promotionOptions = getPromotionOptions(state);
  return captures.map((move) =>
    move.to.y === lastRank
      ? { ...move, promotion: { state: "pending", options: promotionOptions } }
      : move,
  );
};

/**
 * The pawn variants: pieces that replace the pawn corps rather than a single
 * specialist. They all promote on the far rank, so `promotesLikePawn` is set
 * and `variant.ts` lists them as promotion pawns for the engine.
 *
 * Symbols are free letters, except the commoner which uses the Fairy-Stockfish
 * letter for its namesake:
 *   antipawn        = d
 *   commoner        = m
 *   jumping pawn    = j (left) and l (right)
 *   torpedo         = t
 *   sentry          = s
 *   wall            = x
 *
 * The two jumping pawns are the same piece split by the half of the board it
 * starts on, so each has a fixed diagonal towards the centre; `variant.ts`
 * gives each a `mobilityRegion` that keeps it from crossing the centre line.
 */
const pawnPieces = {
  antipawn: {
    symbol: "d",
    betza: "mFcfW",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "duke"),
    value: 1,
    displayName: "Antipawn",
    description:
      "Moves diagonally; captures straight forward. Promotes on the last rank.",
    diagram: {
      size: 5,
      rows: [".....", ".xcx.", "..o..", ".x.x.", "....."],
    },
    behavior: antipawnBehavior,
  },
  commoner: {
    symbol: "m",
    betza: "mfW2cfF2",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "commoner"),
    value: 1,
    displayName: "Commoner",
    description:
      "Moves up to two squares forward; captures up to two squares diagonally forward.",
    diagram: {
      size: 5,
      rows: ["c.x.c", ".cxc.", "..o..", ".....", "....."],
    },
    behavior: commonerBehavior,
  },
  jumpingPawnLeft: {
    symbol: "j",
    betza: "mfWmfrFcbR",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "guardian"),
    value: 1,
    displayName: "Jumping Pawn (Left)",
    description:
      "Moves forward or diagonally towards the centre; captures backwards any distance.",
    diagram: {
      size: 5,
      rows: [".....", "..xx.", "..o..", "..c..", "..c.."],
    },
    behavior: jumpingPawnLeftBehavior,
  },
  jumpingPawnRight: {
    symbol: "l",
    betza: "mfWmflFcbR",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "guardian"),
    value: 1,
    displayName: "Jumping Pawn (Right)",
    description:
      "Moves forward or diagonally towards the centre; captures backwards any distance.",
    diagram: {
      size: 5,
      rows: [".....", ".xx..", "..o..", "..c..", "..c.."],
    },
    behavior: jumpingPawnRightBehavior,
  },
  torpedo: {
    symbol: "t",
    betza: "fW",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "spear"),
    value: 1,
    displayName: "Torpedo",
    description: "Moves and captures one square forward.",
    diagram: {
      size: 5,
      rows: [".....", "..x..", "..o..", ".....", "....."],
    },
    behavior: torpedoBehavior,
  },
  sentry: {
    symbol: "s",
    betza: "mfWcsW",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "sentry"),
    value: 1,
    displayName: "Sentry",
    description: "Moves one square forward; captures one square sideways.",
    diagram: {
      size: 5,
      rows: [".....", "..x..", ".coc.", ".....", "....."],
    },
    behavior: sentryBehavior,
  },
  wall: {
    symbol: "x",
    betza: "cK",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "fortress"),
    value: 1,
    displayName: "Wall",
    description: "Cannot move; captures any adjacent enemy piece.",
    diagram: {
      size: 5,
      rows: [".....", ".ccc.", ".coc.", ".ccc.", "....."],
    },
    behavior: wallBehavior,
  },
} satisfies Record<string, PieceType>;

export default pawnPieces;
