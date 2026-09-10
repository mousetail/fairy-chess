export type Tile = {
  readonly x: number;
  readonly y: number;
};

export function tileToAlgebraic(tile: Tile): string {
  return `${String.fromCharCode(97 + tile.x)}${tile.y + 1}`;
}
