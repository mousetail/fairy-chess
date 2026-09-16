import type { Tile } from "../chess-tile.ts";

/** Center of a tile in the board's 8x8 SVG coordinate space. */
export function tileCenter(tile: Tile): { x: number; y: number } {
  return { x: tile.x + 0.5, y: 7 - tile.y + 0.5 };
}

/**
 * Whether the board is drawn from black's side.
 *
 * The flip is a CSS transform on the board, so every coordinate read off the
 * screen has to be turned back the same way before it means anything.
 */
export function isFlipped(boardElement: HTMLElement): boolean {
  return boardElement.classList.contains("black");
}

/**
 * Where the top-left corner of `tile` sits, in pixels from the board's own
 * top-left corner. This is the position a dragged piece is moved from.
 */
export function tileOffset(
  boardElement: HTMLElement,
  tile: Tile,
  cellSize: number,
): { x: number; y: number } {
  return isFlipped(boardElement)
    ? { x: (7 - tile.x) * cellSize, y: tile.y * cellSize }
    : { x: tile.x * cellSize, y: (7 - tile.y) * cellSize };
}

/** Converts a pointer position to a point in the board's 8x8 coordinate space. */
export function boardPointFromEvent(
  boardElement: HTMLElement,
  event: { clientX: number; clientY: number },
): { x: number; y: number } {
  const rect = boardElement.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 8;
  const y = ((event.clientY - rect.top) / rect.height) * 8;
  // A board seen from black's side is the same board turned half a turn, so a
  // point read off it is the point the other way round.
  return isFlipped(boardElement) ? { x: 8 - x, y: 8 - y } : { x, y };
}

/**
 * Converts a pointer position to the board tile under it. This uses
 * coordinates rather than the event target so it also works for touch
 * pointers, which are implicitly captured by the element they start on.
 */
export function tileFromEvent(
  boardElement: HTMLElement,
  event: { clientX: number; clientY: number },
): Tile | null {
  const point = boardPointFromEvent(boardElement, event);
  const x = Math.floor(point.x);
  const y = 7 - Math.floor(point.y);
  if (x < 0 || x > 7 || y < 0 || y > 7) {
    return null;
  }
  return { x, y };
}
