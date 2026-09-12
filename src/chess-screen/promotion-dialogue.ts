import type { Piece, SpecialMovement } from "../chess-board";
import type { PieceType } from "../chess-game";
import { getImageFromPromise } from "./piece-images";

/** Shows the promotion choices over the board and reports the chosen piece. */
export function createPromotionDialogue(
  boardElement: HTMLElement,
  piece: Piece,
  move: SpecialMovement & { promotion: { state: "pending" } },
  onResolve: (option: PieceType) => void,
): void {
  const dialogue = document.createElement("div");
  dialogue.classList.add("promotion-dialogue");

  for (const option of move.promotion.options) {
    const button = document.createElement("button");
    button.classList.add("promotion-dialogue-button");

    const image = getImageFromPromise(option.image, piece.color);
    button.appendChild(image);

    button.addEventListener("click", () => {
      onResolve(option);
      dialogue.remove();
    });
    dialogue.appendChild(button);
  }

  boardElement.appendChild(dialogue);
}