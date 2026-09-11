import type { ChessBoardState } from "./chess-board";
import backIcon from "./assets/back.svg";
import forwardIcon from "./assets/forward.svg";
import toStartIcon from "./assets/to-start.svg";
import toEndIcon from "./assets/to-end.svg";

export class HistoryBar {
  private root: HTMLDivElement;
  history: Map<HTMLDivElement, ChessBoardState> = new Map();
  viewingHistory: HTMLDivElement | null = null;
  setVisibleState: (state: ChessBoardState) => void;

  earliestLogEntry: HTMLDivElement | null = null;
  latestLogEntry: HTMLDivElement | null = null;

  nextLogEntry: Map<HTMLDivElement, HTMLDivElement> = new Map();
  previousLogEntry: Map<HTMLDivElement, HTMLDivElement> = new Map();

  constructor(
    container: HTMLElement,
    setVisibleState: (state: ChessBoardState) => void,
  ) {
    this.setVisibleState = setVisibleState;

    const movesLogContainer = document.createElement("div");
    movesLogContainer.classList.add("moves-log-container");

    this.root = document.createElement("div");
    this.root.classList.add("moves-log");

    const movesLogHeader = document.createElement("div");
    this.createMovesLogHeaderButtons(movesLogHeader);
    movesLogHeader.classList.add("moves-log-header");
    movesLogContainer.appendChild(movesLogHeader);
    movesLogContainer.appendChild(this.root);
    container.appendChild(movesLogContainer);
  }

  private createMovesLogHeaderButtons(container: HTMLDivElement): void {
    const backToStartButton = document.createElement("button");
    const img1 = document.createElement("img");
    img1.src = toStartIcon;
    backToStartButton.appendChild(img1);
    backToStartButton.classList.add("back-to-start-button");
    backToStartButton.addEventListener("click", () => {
      this.historyBackToStart();
    });
    container.appendChild(backToStartButton);

    const backButton = document.createElement("button");
    const img2 = document.createElement("img");
    img2.src = backIcon;
    backButton.appendChild(img2);
    backButton.classList.add("back-button");
    backButton.addEventListener("click", () => {
      this.historyBack();
    });
    container.appendChild(backButton);

    const forwardButton = document.createElement("button");
    const img3 = document.createElement("img");
    img3.src = forwardIcon;
    forwardButton.appendChild(img3);
    forwardButton.classList.add("forward-button");
    forwardButton.addEventListener("click", () => {
      this.historyForward();
    });
    container.appendChild(forwardButton);

    const forwardToEndButton = document.createElement("button");
    const img4 = document.createElement("img");
    img4.src = toEndIcon;
    forwardToEndButton.appendChild(img4);
    forwardToEndButton.classList.add("forward-to-end-button");
    forwardToEndButton.addEventListener("click", () => {
      this.historyForwardToEnd();
    });
    container.appendChild(forwardToEndButton);
  }

  addLogEntry(state: ChessBoardState, pgn: string): void {
    if (this.root.children.length % 3 === 0) {
      const div2 = document.createElement("div");
      div2.textContent = `${Math.floor(this.root.children.length / 3) + 1}. `;
      this.root.appendChild(div2);
    }

    const div = document.createElement("div");
    div.classList.add("move-log-entry");
    this.root.appendChild(div);
    div.textContent = pgn;
    this.history.set(div, state);
    div.addEventListener("click", () => {
      this.onClickHistoryEntry(div);
    });
    this.viewingHistory?.classList.remove("active");
    this.viewingHistory = div;
    this.viewingHistory?.classList.add("active");

    if (this.earliestLogEntry === null || this.latestLogEntry === null) {
      this.earliestLogEntry = div;
      this.latestLogEntry = div;
    } else {
      this.nextLogEntry.set(this.latestLogEntry, div);
      this.previousLogEntry.set(div, this.latestLogEntry);
      this.latestLogEntry = div;
    }
  }

  onClickHistoryEntry(entry: HTMLDivElement): void {
    if (this.viewingHistory) {
      this.viewingHistory.classList.remove("active");
    }
    entry.classList.add("active");
    this.viewingHistory = entry;
    const state = this.history.get(entry);
    if (!state) {
      return;
    }
    this.setVisibleState(state);
  }

  historyBack(): void {
    if (this.viewingHistory === null) {
      this.viewingHistory = this.latestLogEntry;
    }
    const previous = this.previousLogEntry.get(this.viewingHistory!);
    if (previous) {
      this.onClickHistoryEntry(previous);
    }
  }

  historyForward(): void {
    if (this.viewingHistory === null) {
      this.viewingHistory = this.latestLogEntry;
    }
    const next = this.nextLogEntry.get(this.viewingHistory!);
    if (next) {
      this.onClickHistoryEntry(next);
    }
  }

  historyForwardToEnd(): void {
    if (this.latestLogEntry !== null) {
      this.onClickHistoryEntry(this.latestLogEntry);
    }
  }

  historyBackToStart(): void {
    if (this.earliestLogEntry !== null) {
      this.onClickHistoryEntry(this.earliestLogEntry);
    }
  }
}
