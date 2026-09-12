import type { Tile } from "../chess-tile";
import {
  boardPointFromEvent,
  tileCenter,
  tileFromEvent,
} from "./board-geometry";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
// Length of the arrowhead, and half of its width at the base, in squares.
const ARROW_HEAD_LENGTH = 0.55;
const ARROW_HEAD_HALF_WIDTH = 0.32;

/** Draws the right-click arrows and the drag preview over the board. */
export class ArrowsLayer {
  readonly element: SVGSVGElement;

  private readonly boardElement: HTMLElement;
  private readonly arrows: Map<string, { from: Tile; to: Tile }> = new Map();
  private arrowStart: Tile | null = null;
  private arrowPointerId: number | null = null;
  private arrowPreviewEnd: { x: number; y: number } | null = null;

  constructor(boardElement: HTMLElement) {
    this.boardElement = boardElement;
    this.element = document.createElementNS(SVG_NAMESPACE, "svg");
    this.element.classList.add("arrows-layer");
    this.element.setAttribute("viewBox", "0 0 8 8");
  }

  beginArrow(event: PointerEvent): void {
    const tile = tileFromEvent(this.boardElement, event);
    if (!tile) return;

    event.preventDefault();
    if (event.currentTarget instanceof Element) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    this.arrowStart = tile;
    this.arrowPointerId = event.pointerId;
    this.arrowPreviewEnd = tileCenter(tile);
    this.render();

    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  }

  clear(): void {
    this.arrows.clear();
    this.arrowStart = null;
    this.arrowPointerId = null;
    this.arrowPreviewEnd = null;
    this.render();
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.arrowStart === null || event.pointerId !== this.arrowPointerId) {
      return;
    }
    // Snap the preview to the hovered square, falling back to the raw pointer
    // position when it is outside any square.
    const tile = tileFromEvent(this.boardElement, event);
    this.arrowPreviewEnd = tile
      ? tileCenter(tile)
      : boardPointFromEvent(this.boardElement, event);
    this.render();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.arrowPointerId) return;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);

    const start = this.arrowStart;
    const target =
      event.type === "pointercancel"
        ? null
        : tileFromEvent(this.boardElement, event);
    this.arrowStart = null;
    this.arrowPointerId = null;
    this.arrowPreviewEnd = null;

    if (start && target) {
      const key = `${start.x},${start.y}->${target.x},${target.y}`;
      if (this.arrows.has(key)) {
        this.arrows.delete(key);
      } else {
        this.arrows.set(key, { from: start, to: target });
      }
    }
    this.render();
  };

  private render(): void {
    this.element.replaceChildren();
    for (const { from, to } of this.arrows.values()) {
      this.element.appendChild(
        this.createArrowElement(tileCenter(from), tileCenter(to), false),
      );
    }
    if (this.arrowStart !== null && this.arrowPreviewEnd !== null) {
      this.element.appendChild(
        this.createArrowElement(
          tileCenter(this.arrowStart),
          this.arrowPreviewEnd,
          true,
        ),
      );
    }
  }

  private createArrowElement(
    from: { x: number; y: number },
    to: { x: number; y: number },
    preview: boolean,
  ): SVGElement {
    // A square drawn onto itself is shown as a circle instead of an arrow.
    if (from.x === to.x && from.y === to.y) {
      const circle = document.createElementNS(SVG_NAMESPACE, "circle");
      circle.setAttribute("cx", `${from.x}`);
      circle.setAttribute("cy", `${from.y}`);
      circle.setAttribute("r", "0.4");
      circle.classList.add("arrow-circle");
      if (preview) circle.classList.add("arrow-preview");
      return circle;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    // Unit vector perpendicular to the arrow, used for the head's base.
    const px = -uy;
    const py = ux;
    // Start the tail near the origin square's center.
    const startPad = 0.05;
    // The head's tip sits on the target square's center; the line stops at the
    // head's base so it never pokes out past the tip.
    const baseX = to.x - ux * ARROW_HEAD_LENGTH;
    const baseY = to.y - uy * ARROW_HEAD_LENGTH;

    const line = document.createElementNS(SVG_NAMESPACE, "line");
    line.setAttribute("x1", `${from.x + ux * startPad}`);
    line.setAttribute("y1", `${from.y + uy * startPad}`);
    line.setAttribute("x2", `${baseX + ux * 0.02}`);
    line.setAttribute("y2", `${baseY + uy * 0.02}`);
    line.classList.add("arrow-line");
    if (preview) line.classList.add("arrow-preview");

    const head = document.createElementNS(SVG_NAMESPACE, "polygon");
    head.setAttribute(
      "points",
      [
        `${to.x},${to.y}`,
        `${baseX + px * ARROW_HEAD_HALF_WIDTH},${baseY + py * ARROW_HEAD_HALF_WIDTH}`,
        `${baseX - px * ARROW_HEAD_HALF_WIDTH},${baseY - py * ARROW_HEAD_HALF_WIDTH}`,
      ].join(" "),
    );
    head.classList.add("arrow-head");
    if (preview) head.classList.add("arrow-preview");

    const group = document.createElementNS(SVG_NAMESPACE, "g");
    group.appendChild(line);
    group.appendChild(head);
    return group;
  }
}