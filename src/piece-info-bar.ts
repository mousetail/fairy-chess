import type { PieceType } from "./pieces/piece_types/index.ts";
import { parseDiagram, type DiagramTile } from "./pieces/diagram.ts";
import { getImageFromPromise } from "./chess-screen/piece-images.ts";

const tileClass: Record<DiagramTile, string> = {
  empty: "empty",
  piece: "piece",
  move: "move",
  capture: "capture",
};

/**
 * Panel describing the currently selected piece: its name, any aliases, a
 * diagram of how it moves, and a short explanation.
 */
export class PieceInfoBar {
  readonly element: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly aliases: HTMLDivElement;
  private readonly diagram: HTMLDivElement;
  private readonly description: HTMLDivElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.classList.add("piece-info");

    this.title = document.createElement("div");
    this.title.classList.add("piece-info-title");

    this.aliases = document.createElement("div");
    this.aliases.classList.add("piece-info-aliases");

    this.diagram = document.createElement("div");
    this.diagram.classList.add("piece-info-diagram");

    this.description = document.createElement("div");
    this.description.classList.add("piece-info-description");

    this.element.append(
      this.title,
      this.aliases,
      this.diagram,
      this.description,
    );

    this.show(null);
  }

  /** Shows the given piece, or a placeholder prompt when nothing is selected. */
  show(piece: PieceType | null): void {
    if (!piece) {
      this.element.classList.add("empty");
      this.title.textContent = "";
      this.aliases.textContent = "";
      this.description.textContent = "";
      this.diagram.replaceChildren();
      this.diagram.style.removeProperty("--size");
      return;
    }

    this.element.classList.remove("empty");
    this.title.textContent = piece.displayName;
    this.aliases.textContent =
      piece.aliases && piece.aliases.length > 0
        ? `a.k.a. ${piece.aliases.join(", ")}`
        : "";
    this.description.textContent = piece.description;
    this.renderDiagram(piece);
  }

  private renderDiagram(piece: PieceType): void {
    const tiles = parseDiagram(piece.diagram);
    this.diagram.style.setProperty("--size", `${piece.diagram.size}`);
    this.diagram.replaceChildren(
      ...tiles.flatMap((row, rowIndex) =>
        row.map((tile, columnIndex) => {
          const cell = document.createElement("div");
          cell.classList.add(
            "piece-info-tile",
            (rowIndex + columnIndex) % 2 === 0 ? "even" : "odd",
            tileClass[tile],
          );
          if (tile === "piece") {
            const image = getImageFromPromise(piece.image, "white");
            image.classList.add("piece-info-piece");
            cell.appendChild(image);
          }
          return cell;
        }),
      ),
    );
  }
}
