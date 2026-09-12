import type { Tile } from "../chess-tile";

/** Center of a tile in the board's 8x8 SVG coordinate space. */
export function tileCenter(tile: Tile): { x: number; y: number } {
  return { x: tile.x + 0.5, y: 7 - tile.y + 0.5 };
}

/** Converts a pointer position to a point in the board's 8x8 coordinate space. */
export function boardPointFromEvent(
  boardElement: HTMLElement,
  event: { clientX: number; clientY: number },
): { x: number; y: number } {
  const rect = boardElement.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 8,
    y: ((event.clientY - rect.top) / rect.height) * 8,
  };
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