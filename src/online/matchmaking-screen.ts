import { invertColor } from "../chess-board.ts";
import ChessScreen from "../chess-screen/index.ts";
import { chaosLevels } from "../replacement-rules.ts";
import type { Screen } from "../screen.ts";
import { MatchmakingClient } from "./client.ts";
import { matchmakingUrl } from "./config.ts";
import {
  PROTOCOL_VERSION,
  type Color,
  type ServerMessage,
} from "./protocol.ts";

export interface MatchmakingScreenOptions {
  /** The chaos level asked for, as an index into {@link chaosLevels}. */
  complexity: number;
  /** The name to show the opponent, or an empty string to stay anonymous. */
  name: string;
  /** Hands the player back to the home screen. */
  onLeave(): void;
}

/** The parts of the waiting panel that change while the search runs. */
interface SearchPanel {
  status: HTMLParagraphElement;
  queue: HTMLParagraphElement;
  level: HTMLParagraphElement;
  leave: HTMLButtonElement;
}

/**
 * Finding an opponent, and then playing them.
 *
 * The screen owns the whole online side of a game: the waiting panel, the
 * connection, and the board the server referees. It hands the board a position
 * and a way to ask for moves, and nothing else — every position it shows is one
 * the server sent, so the two cannot drift apart.
 */
export class MatchmakingScreen implements Screen {
  private readonly options: MatchmakingScreenOptions;
  private client: MatchmakingClient | null = null;
  private chessScreen: ChessScreen | null = null;
  private panel: SearchPanel | null = null;
  private parent: HTMLElement | null = null;
  /** The level to ask for; the server may narrow the range it accepts. */
  private complexity: number;
  /** The level labels the server named, until then the ones from the rules. */
  private labels: string[] = chaosLevels.map((level) => level.label);
  /** The colour the server gave this browser, once a game has started. */
  private color: Color | null = null;

  constructor(options: MatchmakingScreenOptions) {
    this.options = options;
    this.complexity = options.complexity;
  }

  activate(parent: HTMLElement): void {
    this.parent = parent;
    this.search();
  }

  deactivate(): void {
    this.client?.dispose();
    this.client = null;
    this.chessScreen?.deactivate();
    this.chessScreen = null;
    this.panel = null;
    this.parent = null;
  }

  /**
   * Leaves a finished game behind and asks the server for a new opponent.
   *
   * Each search opens its own connection: the game the last one played is over
   * by the time the player asks for another, and starting clean is easier to
   * follow than reusing a socket that has already been through a game.
   */
  private search(): void {
    const parent = this.parent;
    if (!parent) return;

    this.chessScreen?.deactivate();
    this.chessScreen = null;
    this.client?.dispose();

    parent.replaceChildren();
    const panel = this.createSearchPanel(parent);
    this.panel = panel;

    const client = new MatchmakingClient(matchmakingUrl, {
      onMessage: (message) => this.receive(message),
      onClose: () => this.reportDisconnect(),
    });
    this.client = client;

    client.ready.then(
      () => {
        if (this.client !== client) return;
        panel.status.textContent = "Waiting for an opponent…";
        client.join(this.complexity, this.options.name);
      },
      (error: unknown) => {
        if (this.client !== client) return;
        this.fail(panel, describe(error));
      },
    );
  }

  private createSearchPanel(parent: HTMLElement): SearchPanel {
    const panel = document.createElement("div");
    panel.classList.add("matchmaking-panel");

    const header = document.createElement("h1");
    header.textContent = "Online game";
    panel.appendChild(header);

    const status = document.createElement("p");
    status.classList.add("matchmaking-status");
    status.textContent = "Connecting to the matchmaking server…";
    panel.appendChild(status);

    const level = document.createElement("p");
    level.classList.add("matchmaking-level");
    level.textContent = this.levelText();
    panel.appendChild(level);

    const hint = document.createElement("p");
    hint.classList.add("matchmaking-hint");
    hint.textContent =
      "You may be matched with anyone within one level of this, and the game " +
      "is played at the level you both accept that is closest to it.";
    panel.appendChild(hint);

    const queue = document.createElement("p");
    queue.classList.add("matchmaking-queue");
    queue.hidden = true;
    panel.appendChild(queue);

    const leave = document.createElement("button");
    leave.classList.add("play-button");
    leave.textContent = "Cancel";
    leave.addEventListener("click", () => this.leave());
    panel.appendChild(leave);

    parent.appendChild(panel);
    return { status, queue, level, leave };
  }

  /** The line naming the level this browser is asking to play at. */
  private levelText(): string {
    const label = this.labels[this.complexity] ?? chaosLevels[0].label;
    return `Playing at: ${label}`;
  }

  /** Takes the player out of the queue, or out of a game that has finished. */
  private leave(): void {
    this.deactivate();
    this.options.onLeave();
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.receiveWelcome(message);
        return;
      case "queued":
        if (this.panel) {
          this.panel.queue.hidden = false;
          this.panel.queue.classList.remove("error");
          this.panel.queue.textContent = message.waiting === 1
            ? "Nobody else is waiting yet."
            : `Players waiting: ${message.waiting}`;
        }
        return;
      case "queueCancelled":
        // Only ever sent because this screen asked to leave, which it does by
        // closing the connection instead.
        return;
      case "matched":
        this.startGame(message);
        return;
      case "moved":
        this.chessScreen?.applyServerMove(
          message.board,
          message.pgn,
          message.inCheck,
        );
        return;
      case "moveRejected":
        this.chessScreen?.reportRejection(message.rejection);
        return;
      case "gameOver":
        this.chessScreen?.declareResult(message.status, message.winner);
        return;
      case "opponentLeft":
        this.chessScreen?.declareResult("resign", message.winner);
        this.chessScreen?.showNotice("Your opponent left the game.");
        return;
      case "error":
        this.reportError(message.message);
        return;
      case "ping":
        // The keepalive is answered by the client, not by the screen.
        return;
    }
  }

  private receiveWelcome(
    message: Extract<ServerMessage, { type: "welcome" }>,
  ): void {
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      const panel = this.panel;
      this.client?.dispose();
      this.client = null;
      if (panel) {
        this.fail(
          panel,
          `This page speaks protocol ${PROTOCOL_VERSION} but the matchmaking ` +
            `server speaks ${message.protocolVersion}. Reload the page to pick ` +
            `up the current version.`,
        );
      }
      return;
    }

    this.labels = message.complexityLabels;
    this.complexity = Math.min(
      message.maxComplexity,
      Math.max(message.minComplexity, this.complexity),
    );
    if (this.panel) this.panel.level.textContent = this.levelText();
  }

  private startGame(
    message: Extract<ServerMessage, { type: "matched" }>,
  ): void {
    const parent = this.parent;
    if (!parent) return;

    this.panel = null;
    this.color = message.color;

    // Both sides are people, so the bars are named from the server's view of
    // who is who: this browser is "You", whoever it was given.
    const playerNames: Record<Color, string> = message.color === "white"
      ? { white: "You", black: message.opponentName }
      : { white: message.opponentName, black: "You" };

    const screen = new ChessScreen({
      initialBoard: message.board,
      playerNames,
      online: {
        color: message.color,
        requestMove: (request) => this.client?.move(request),
        resign: () => this.client?.resign(),
      },
      onPlayAgain: () => this.search(),
    });
    this.chessScreen = screen;
    screen.activate(parent);
    screen.showNotice(`Playing at: ${message.complexityLabel}`);
  }

  private reportError(text: string): void {
    if (this.chessScreen) {
      this.chessScreen.showNotice(text);
      return;
    }
    const panel = this.panel;
    if (!panel) return;
    panel.queue.hidden = false;
    panel.queue.classList.add("error");
    panel.queue.textContent = text;
  }

  private reportDisconnect(): void {
    const screen = this.chessScreen;
    if (screen) {
      if (screen.gameEnded || this.color === null) return;
      // Whoever stayed would have been awarded the win, so the game is over
      // here too; the notice says why.
      screen.declareResult("resign", invertColor(this.color));
      screen.showNotice(
        "The connection to the matchmaking server was lost, so the game is over.",
      );
      return;
    }

    const panel = this.panel;
    if (panel) {
      this.fail(panel, "The connection to the matchmaking server was lost.");
    }
  }

  /** Reports a problem that stops the search, leaving the player a way out. */
  private fail(panel: SearchPanel, text: string): void {
    panel.status.classList.add("error");
    panel.status.textContent = text;
    panel.leave.textContent = "Back to menu";
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
