import type { Piece, SpecialMovement, TaggedMove } from "../chess-board";
import type { Tile } from "../chess-tile";
import { getImageFromPromise } from "./piece-images";

export interface BoardHandlers {
  onTileClick(tile: Tile): void;
  onPointerDown(event: PointerEvent): void;
}

/** Owns the board's DOM: the tile grid, the pieces, and the overlay markers. */
export class BoardView {
  readonly element: HTMLDivElement;

  private readonly grid: HTMLDivElement;
  private readonly cellRows: HTMLDivElement[][] = [];
  private readonly piecesDivs: Map<number, HTMLImageElement> = new Map();
  private readonly checkMarker: HTMLDivElement;
  private dragHighlight: HTMLDivElement | null = null;
  private highlightedTiles: HTMLDivElement[] = [];
  private pips: HTMLDivElement[] = [];

  constructor(handlers: BoardHandlers) {
    this.element = document.createElement("div");
    this.element.classList.add("board-outer");
    this.element.addEventListener("contextmenu", (event) =>
      event.preventDefault(),
    );

    this.grid = document.createElement("div");
    this.element.appendChild(this.grid);
    for (let i = 0; i < 8; i++) {
      const row = document.createElement("div");
      row.classList.add("row");
      const cells: HTMLDivElement[] = [];
      for (let j = 0; j < 8; j++) {
        const cell = document.createElement("div");
        cell.classList.add("cell", (i + j) % 2 == 0 ? "even" : "odd");
        cell.dataset.tileX = `${j}`;
        cell.dataset.tileY = `${7 - i}`;

        cell.addEventListener("click", () => {
          handlers.onTileClick({ x: j, y: 7 - i });
        });
        cell.addEventListener("contextmenu", (event) =>
          event.preventDefault(),
        );
        cell.addEventListener("pointerdown", (event) =>
          handlers.onPointerDown(event),
        );

        row.appendChild(cell);
        cells.push(cell);
      }
      this.grid.appendChild(row);
      this.cellRows.push(cells);
    }

    this.checkMarker = document.createElement("div");
    this.checkMarker.classList.add("check-marker");
  }

  /**
   * Inserts the arrows SVG between the grid and the pieces. Call this before
   * adding pieces so the arrows render underneath them.
   */
  setArrowsLayer(layer: SVGElement): void {
    this.element.appendChild(layer);
  }

  addPiece(piece: Piece): void {
    const image = getImageFromPromise(piece.type.image, piece.color);
    image.classList.add("board-piece");
    this.piecesDivs.set(piece.id, image);
    this.element.appendChild(image);

    image.style.setProperty("--x", `${piece.position.x}`);
    image.style.setProperty("--y", `${piece.position.y}`);
  }

  destroyPiece(id: number): void {
    const image = this.piecesDivs.get(id);
    if (!image) {
      throw new Error(`Piece to destroy not found: ${id}`);
    }
    image.remove();
    this.piecesDivs.delete(id);
  }

  movePiece(pieceId: number, tile: Tile): void {
    const image = this.piecesDivs.get(pieceId);
    if (!image) {
      throw new Error(`Piece to move not found: ${pieceId}`);
    }
    image.style.setProperty("--x", `${tile.x}`);
    image.style.setProperty("--y", `${tile.y}`);
  }

  getPieceImage(id: number): HTMLImageElement | undefined {
    return this.piecesDivs.get(id);
  }

  clearPieces(): void {
    this.piecesDivs.forEach((image) => image.remove());
    this.piecesDivs.clear();
  }

  /** Marks the square a dragged piece would be dropped on, if any. */
  setDragHighlight(tile: Tile | null): void {
    if (!tile) {
      this.dragHighlight?.remove();
      this.dragHighlight = null;
      return;
    }
    if (!this.dragHighlight) {
      this.dragHighlight = document.createElement("div");
      this.dragHighlight.classList.add("drag-highlight");
      this.element.appendChild(this.dragHighlight);
    }
    this.dragHighlight.style.setProperty("--x", `${tile.x}`);
    this.dragHighlight.style.setProperty("--y", `${tile.y}`);
  }

  /** Shows the check marker on the given king tile, or hides it when null. */
  setCheckMarker(tile: Tile | null): void {
    if (!tile) {
      this.checkMarker.remove();
      return;
    }
    this.checkMarker.style.setProperty("--x", `${tile.x}`);
    this.checkMarker.style.setProperty("--y", `${tile.y}`);
    this.element.appendChild(this.checkMarker);
  }

  showMovePips(moves: SpecialMovement[]): void {
    this.clearMovePips();
    for (const move of moves) {
      const pip = document.createElement("div");
      pip.classList.add(move.type === "capture" ? "border" : "pip");
      pip.style.setProperty("--x", `${move.to.x}`);
      pip.style.setProperty("--y", `${move.to.y}`);

      this.element.appendChild(pip);
      this.pips.push(pip);
    }
  }

  clearMovePips(): void {
    this.pips.forEach((pip) => pip.remove());
    this.pips = [];
  }

  setHighlightedMoves(latestMove: TaggedMove): void {
    this.highlightedTiles.forEach((tile) =>
      tile.classList.remove("highlighted"),
    );
    this.highlightedTiles = [
      this.cellRows[7 - latestMove.from.y][latestMove.from.x],
      this.cellRows[7 - latestMove.to.y][latestMove.to.x],
    ];
    this.highlightedTiles.forEach((tile) => tile.classList.add("highlighted"));
  }
}