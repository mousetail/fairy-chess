import type { ChessBoardState } from "../chess-board";
import type { PieceType } from ".";

/**
 * The piece types a pawn may promote to in the given position.
 *
 * The candidates are the pieces in play, so a variant never offers promotions
 * to pieces that are not on the board. Pieces with `promotionAbility: "deny"`
 * (such as pawns and the royal king) are always excluded. If any of the pieces
 * in play has `promotionAbility: "priority"`, only those pieces are offered.
 *
 * Sorted from most to least valuable so the promotion dialogue shows the
 * strongest options first.
 */
export function getPromotionOptions(state: ChessBoardState): PieceType[] {
  const inPlay = [...state.symbols.keys()];
  const priority = inPlay.filter(
    (type) => type.promotionAbility === "priority",
  );
  const candidates =
    priority.length > 0
      ? priority
      : inPlay.filter((type) => type.promotionAbility !== "deny");
  return candidates.sort((a, b) => b.value - a.value);
}
