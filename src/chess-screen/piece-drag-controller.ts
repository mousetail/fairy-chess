import type { Piece, SpecialMovement } from "../chess-board";
import type { Tile } from "../chess-tile";
import { tileFromEvent } from "./board-geometry";

type DragState = {
  piece: Piece;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startImageX: number;
  startImageY: number;
  moved: boolean;
};

/** What the drag controller needs from the screen to apply a drop. */
export interface DragHost {
  getPieceImage(id: number): HTMLImageElement | undefined;
  getSelection(): { piece: Piece; moves: SpecialMovement[] } | null;
  selectPiece(piece: Piece): void;
  performMove(piece: Piece, move: SpecialMovement): void;
  clearSelection(): void;
  setDragHighlight(tile: Tile | null): void;
}

/** Handles dragging a piece with the pointer, including tap-vs-drag. */
export class PieceDragController {
  private readonly boardElement: HTMLElement;
  private readonly host: DragHost;
  private dragState: DragState | null = null;

  constructor(boardElement: HTMLElement, host: DragHost) {
    this.boardElement = boardElement;
    this.host = host;
  }

  start(event: PointerEvent, piece: Piece): void {
    const image = this.host.getPieceImage(piece.id);
    if (!image) return;

    if (event.currentTarget instanceof Element) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    // Selecting here shows the destination pips immediately, including while
    // the piece is being dragged.
    this.host.selectPiece(piece);

    // Position the piece in pixels so it can follow the pointer exactly.
    const cellSize = this.boardElement.getBoundingClientRect().width / 8;
    this.dragState = {
      piece,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startImageX: piece.position.x * cellSize,
      startImageY: (7 - piece.position.y) * cellSize,
      moved: false,
    };
    image.classList.add("dragging");
    image.style.transform = `translate(${this.dragState.startImageX}px, ${this.dragState.startImageY}px)`;

    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
  }

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    // A few pixels of jitter still count as a tap, not a drag.
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
    }

    const image = this.host.getPieceImage(drag.piece.id);
    if (image) {
      image.style.transform = `translate(${drag.startImageX + dx}px, ${drag.startImageY + dy}px)`;
    }

    // Once it's a real drag, highlight the square the pointer is over, but only
    // when dropping there would be a legal move.
    if (drag.moved) {
      const tile = tileFromEvent(this.boardElement, event);
      const selection = this.host.getSelection();
      const isValidTarget =
        tile !== null &&
        selection?.piece.id === drag.piece.id &&
        selection.moves.some(
          (candidate) =>
            candidate.to.x === tile.x && candidate.to.y === tile.y,
        );
      this.host.setDragHighlight(isValidTarget ? tile : null);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.endDrag(drag, tileFromEvent(this.boardElement, event));
  };

  private onPointerCancel = (event: PointerEvent): void => {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.endDrag(drag, null);
  };

  private endDrag(drag: DragState, target: Tile | null): void {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);

    const image = this.host.getPieceImage(drag.piece.id);
    if (image) {
      image.classList.remove("dragging");
      image.style.transform = "";
    }
    this.host.setDragHighlight(null);
    this.dragState = null;

    // Without meaningful movement this was a tap; the click handler will
    // manage the selection.
    if (!drag.moved) return;

    const selection = this.host.getSelection();
    const move =
      target && selection && selection.piece.id === drag.piece.id
        ? selection.moves.find(
            (candidate) =>
              candidate.to.x === target.x && candidate.to.y === target.y,
          )
        : undefined;

    if (move) {
      this.host.performMove(drag.piece, move);
    } else {
      this.host.clearSelection();
    }
  }
}