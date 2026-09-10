import type { ChessBoardState } from "./chess-board";

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
    backToStartButton.textContent = "|<";
    backToStartButton.classList.add("back-to-start-button");
    backToStartButton.addEventListener("click", () => {
      this.historyBackToStart();
    });
    container.appendChild(backToStartButton);

    const backButton = document.createElement("button");
    backButton.textContent = "<";
    backButton.classList.add("back-button");
    backButton.addEventListener("click", () => {
      this.historyBack();
    });
    container.appendChild(backButton);

    const forwardButton = document.createElement("button");
    forwardButton.textContent = ">";
    forwardButton.classList.add("forward-button");
    forwardButton.addEventListener("click", () => {
      this.historyForward();
    });
    container.appendChild(forwardButton);

    const forwardToEndButton = document.createElement("button");
    forwardToEndButton.textContent = ">|";
    forwardToEndButton.classList.add("forward-to-end-button");
    forwardToEndButton.addEventListener("click", () => {
      this.historyForwardToEnd();
    });
    container.appendChild(forwardToEndButton);
  }

  addLogEntry(state: ChessBoardState, pgn: string): void {
    const div = document.createElement("div");
    div.classList.add("move-log-entry");
    this.root.appendChild(div);
    const moveNumber = Math.floor(this.root.children.length / 2) + 1;
    div.textContent =
      (this.root.children.length % 2 === 1 ? moveNumber + ". " : "") + pgn;
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
