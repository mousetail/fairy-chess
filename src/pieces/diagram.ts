/** How a single tile of a piece's movement diagram is drawn. */
export type DiagramTile = "empty" | "piece" | "move" | "capture";

/**
 * A hand-drawn picture of how a piece moves, shown in the piece info panel.
 *
 * `rows` holds one string per row, top row first, and each character describes
 * a single tile:
 *   `.` empty
 *   `o` the piece itself
 *   `x` a square the piece can move to (and usually capture on)
 *   `c` a square the piece can only capture on
 */
export interface PieceDiagram {
  /** Width and height of the diagram, in tiles. */
  size: number;
  rows: string[];
}

const tileForCharacter: Record<string, DiagramTile> = {
  ".": "empty",
  o: "piece",
  x: "move",
  c: "capture",
};

/** Expands a {@link PieceDiagram} into a `size` by `size` grid of tile kinds. */
export function parseDiagram(diagram: PieceDiagram): DiagramTile[][] {
  return diagram.rows.map((row) =>
    [...row].map((character) => {
      const tile = tileForCharacter[character];
      if (!tile) {
        throw new Error(`Unknown diagram tile character: "${character}"`);
      }
      return tile;
    }),
  );
}
