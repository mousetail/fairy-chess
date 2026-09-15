import type { ChessBoardState, Piece, TaggedMove } from "../src/chess-board.ts";
import { resolveSymbols } from "../src/chess-game.ts";
import type { Tile } from "../src/chess-tile.ts";
import type { PieceType } from "../src/pieces/piece_types/index.ts";

export function tileFromAlgebraic(square: string): Tile {
  return {
    x: square.charCodeAt(0) - "a".charCodeAt(0),
    y: Number(square[1]) - 1,
  };
}

export function algebraicFromTile(tile: Tile): string {
  return `${String.fromCharCode("a".charCodeAt(0) + tile.x)}${tile.y + 1}`;
}

export interface Placement {
  type: PieceType;
  color: "white" | "black";
  square: string;
  hasMoved?: boolean;
}

export interface BuildStateOptions {
  lastMove?: TaggedMove;
  /** The symbol map to use; defaults to resolving the symbols of the pieces. */
  symbols?: Map<PieceType, string>;
}

export function buildState(
  placements: Placement[],
  turn: "white" | "black",
  options: BuildStateOptions = {},
): ChessBoardState {
  const pieces: Piece[] = placements.map((placement, index) => ({
    type: placement.type,
    color: placement.color,
    position: tileFromAlgebraic(placement.square),
    hasMoved: placement.hasMoved ?? false,
    id: index,
  }));
  return {
    pieces,
    turn,
    halfTurnNumber: 0,
    lastMove: options.lastMove,
    symbols:
      options.symbols ?? resolveSymbols(new Set(pieces.map((piece) => piece.type))),
  };
}

export interface FenPlacement {
  symbol: string;
  color: "white" | "black";
  square: string;
}

/**
 * A FEN for a position that needs neither castling rights nor an en passant
 * square, which is enough for the single-piece comparisons.
 */
export function fenFromPlacements(
  placements: FenPlacement[],
  turn: "white" | "black",
): string {
  const rows: string[] = [];
  for (let y = 7; y >= 0; y--) {
    let row = "";
    let empty = 0;
    for (let x = 0; x < 8; x++) {
      const placement = placements.find((candidate) => {
        const tile = tileFromAlgebraic(candidate.square);
        return tile.x === x && tile.y === y;
      });
      if (!placement) {
        empty++;
        continue;
      }
      if (empty > 0) {
        row += empty;
        empty = 0;
      }
      row +=
        placement.color === "white"
          ? placement.symbol.toUpperCase()
          : placement.symbol.toLowerCase();
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} ${turn === "white" ? "w" : "b"} - - 0 1`;
}
