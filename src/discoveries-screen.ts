import classicPieces from "./pieces/piece_types/classic.ts";
import combinationPieces from "./pieces/piece_types/combinations.ts";
import fairyPieces from "./pieces/piece_types/fairy.ts";
import kingPieces from "./pieces/piece_types/kings.ts";
import pawnPieces from "./pieces/piece_types/pawns.ts";
import type { PieceType } from "./pieces/piece_types/index.ts";
import { getImageFromPromise } from "./chess-screen/piece-images.ts";
import { PieceInfoBar } from "./piece-info-bar.ts";
import {
  discoverySummaryText,
  isDiscovered,
  loadDiscoveries,
  summarize,
  type DiscoveryRecords,
  type PieceRecord,
} from "./discoveries.ts";
import type { Screen } from "./screen.ts";

interface PieceCategory {
  label: string;
  pieces: Record<string, PieceType>;
}

/** The piece types grouped the way they are defined, in the order they load. */
const categories: PieceCategory[] = [
  { label: "Classic", pieces: classicPieces },
  { label: "Fairy", pieces: fairyPieces },
  { label: "Combinations", pieces: combinationPieces },
  { label: "Pawns", pieces: pawnPieces },
  { label: "Kings", pieces: kingPieces },
];

/**
 * Lists every piece, grouped by category, with the discovered pieces first.
 * Pieces that have never been in a finished game are shown as a plain black
 * card, and pieces the player has won with are marked with a border.
 */
export class DiscoveriesScreen implements Screen {
  private readonly onBack: () => void;
  /** The open piece modal, or `null` when none is showing. */
  private modal: HTMLDivElement | null = null;

  constructor(onBack: () => void) {
    this.onBack = onBack;
  }

  activate(parent: HTMLElement): void {
    parent.replaceChildren();

    const container = document.createElement("div");
    container.classList.add("discoveries");
    parent.appendChild(container);

    const header = document.createElement("h1");
    header.textContent = "Discovered Pieces";
    container.appendChild(header);

    const records = loadDiscoveries();

    const summary = document.createElement("p");
    summary.classList.add("text-max-width");
    summary.textContent = discoverySummaryText(summarize(records));
    container.appendChild(summary);

    for (const category of categories) {
      container.appendChild(this.createCategory(category, records));
    }

    const backButton = document.createElement("button");
    backButton.classList.add("button", "play-button");
    backButton.textContent = "Back";
    backButton.addEventListener("click", () => {
      this.deactivate();
      this.onBack();
    });
    container.appendChild(backButton);
  }

  deactivate(): void {
    this.closeModal();
  }

  private createCategory(
    category: PieceCategory,
    records: DiscoveryRecords,
  ): HTMLElement {
    const section = document.createElement("section");
    section.classList.add("discovery-category");

    const heading = document.createElement("h2");
    heading.textContent = category.label;
    section.appendChild(heading);

    const grid = document.createElement("div");
    grid.classList.add("discovery-grid");
    const entries = Object.entries(category.pieces);
    const discovered = entries.filter(([key]) => isDiscovered(records[key]));
    const undiscovered = entries.filter(([key]) => !isDiscovered(records[key]));
    for (const [key, type] of [...discovered, ...undiscovered]) {
      grid.appendChild(this.createCard(type, records[key]));
    }
    section.appendChild(grid);

    return section;
  }

  private createCard(
    type: PieceType,
    record: PieceRecord | undefined,
  ): HTMLDivElement {
    const card = document.createElement("div");
    card.classList.add("discovery-card");

    if (!isDiscovered(record)) {
      card.classList.add("undiscovered");
      return card;
    }

    if (record.wins > 0) card.classList.add("won");

    // Discovered cards open the same panel the game shows in its sidebar.
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Show details for ${type.displayName}`);
    card.addEventListener("click", () => this.openModal(type));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.openModal(type);
    });

    const image = getImageFromPromise(type.image, "white");
    image.classList.add("discovery-piece");
    card.appendChild(image);

    const name = document.createElement("div");
    name.classList.add("discovery-name");
    name.textContent = type.displayName;
    card.appendChild(name);

    const stats = document.createElement("div");
    stats.classList.add("discovery-stats");
    stats.textContent = `W/D/L: ${record.wins} · ${record.ties} · ${record.losses}`;
    card.appendChild(stats);

    if (record.defeatedOpponents.length > 0) {
      const opponents = document.createElement("div");
      opponents.classList.add("discovery-opponents");
      opponents.textContent = `Beat ${record.defeatedOpponents.slice(0,1).join(", ")}`;
      card.appendChild(opponents);
    }

    return card;
  }

  /** Opens the piece info panel in a modal over the page. */
  private openModal(type: PieceType): void {
    this.closeModal();

    const overlay = document.createElement("div");
    overlay.classList.add("modal-overlay");
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this.closeModal();
    });

    const modal = document.createElement("div");
    modal.classList.add("piece-modal");
    overlay.appendChild(modal);

    const info = new PieceInfoBar();
    info.show(type);
    modal.appendChild(info.element);

    const closeButton = document.createElement("button");
    closeButton.classList.add("button", "modal-close");
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => this.closeModal());
    modal.appendChild(closeButton);

    document.addEventListener("keydown", this.onModalKeyDown);
    document.body.appendChild(overlay);
    this.modal = overlay;
    closeButton.focus();
  }

  private closeModal(): void {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
    document.removeEventListener("keydown", this.onModalKeyDown);
  }

  private onModalKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.closeModal();
  };
}
