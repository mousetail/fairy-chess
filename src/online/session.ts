import { chaosLevels } from "../replacement-rules.ts";
import { MatchmakingClient, type SocketFactory } from "./client.ts";
import { matchmakingUrl } from "./config.ts";
import {
  PROTOCOL_VERSION,
  type Color,
  type GameOverStatus,
  type MoveRejection,
  type MoveRequest,
  type ServerMessage,
  type TimeControlSpec,
} from "./protocol.ts";
import type { SerializedBoardState } from "./serialization.ts";
import {
  clampTimeControl,
  timeControlLabel,
  timeControls,
} from "./time-controls.ts";

/**
 * The player's connection to the matchmaking server, which outlives any screen.
 *
 * A screen cannot own this. Waiting for an opponent is not a page of its own:
 * the player carries on reading their discoveries and the game arrives whenever
 * somebody else queues, so the socket and the state of the search belong above
 * the screens, and the screens ask about them.
 */

/** What the player is doing online, if anything. */
export type MatchmakingStatus =
  | { readonly state: "idle" }
  /** The socket is being opened, or a join has been sent and not yet answered. */
  | { readonly state: "connecting" }
  | { readonly state: "queued"; readonly waiting: number }
  /** The search stopped before a game started. */
  | { readonly state: "error"; readonly message: string };

/** How a game in progress tells the screen showing it what happened. */
export interface GameListener {
  /**
   * The position after an accepted move; the board is replaced with it. `color`
   * is the side that just moved, which is how the board learns it may no longer
   * call the game off.
   */
  moved(
    board: SerializedBoardState,
    pgn: string,
    inCheck: boolean,
    color: Color,
  ): void;
  /**
   * What each player's clock has left, and whose is running. Sent on every move
   * and again while a clock runs, so a client that ticked on its own catches
   * up with the server.
   */
  clock(white: number, black: number, running: Color | null): void;
  /** A move this browser asked for was refused. */
  moveRejected(rejection: MoveRejection): void;
  /** The game ended. */
  gameOver(status: GameOverStatus, winner: Color | "draw" | null): void;
  /** The opponent's connection dropped, so this browser wins. */
  opponentLeft(winner: Color): void;
  /** Someone offered a draw, naming the side that offered. */
  drawOffered(color: Color): void;
  /** Something the server said that the board should show as a message. */
  notice(text: string): void;
  /** The connection dropped, so the game can go no further. */
  disconnected(): void;
}

/** A game in progress, as the app and the board see it. */
export interface OnlineGame {
  /** The colour this browser plays. */
  readonly color: Color;
  /** The name this browser asked to be shown as, possibly empty. */
  readonly playerName: string;
  /** The name the opponent asked to be shown as. */
  readonly opponentName: string;
  /** The chaos level the server picked for this game. */
  readonly complexity: number;
  readonly complexityLabel: string;
  /** The clocks the server picked for this game. */
  readonly timeControl: TimeControlSpec;
  /** The starting position, as the server laid it out. */
  readonly board: SerializedBoardState;
  /**
   * Registers the screen showing this game, which hears about everything that
   * happens from here on. Nothing can arrive in between: a game only starts
   * while the app is dealing with the message that announced it.
   */
  listen(listener: GameListener): void;
  /** Asks the server to play a move; the board changes when it accepts. */
  requestMove(request: MoveRequest): void;
  /** Ends the game in the opponent's favour. */
  resign(): void;
  /**
   * Calls the game off, before this browser has moved. The game ends with no
   * result rather than in a loss.
   */
  abort(): void;
  /** Offers a draw, which the game is drawn on once the opponent offers too. */
  offerDraw(): void;
}

/** How a game sends what the player asks for. */
interface GameSender {
  move(request: MoveRequest): void;
  resign(): void;
  abort(): void;
  offerDraw(): void;
}

export interface MatchmakingSessionOptions {
  /**
   * Called when a game starts, so the app can put the board on screen. The
   * session has already cleared its own state by the time this runs.
   */
  onGame(game: OnlineGame): void;
  /**
   * The server to talk to, in place of the one the build was made with. Tests
   * set it; a blank value stands for a build that was told of none.
   */
  url?: string;
  /** How sockets are made; overridable so tests need no server. */
  createSocket?: SocketFactory;
}

export class MatchmakingSession {
  private readonly options: MatchmakingSessionOptions;
  private readonly watchers = new Set<(status: MatchmakingStatus) => void>();
  private currentStatus: MatchmakingStatus = { state: "idle" };
  private client: MatchmakingClient | null = null;
  private game: Game | null = null;
  /** The level labels, until the server says which ones it knows. */
  private labels: string[] = chaosLevels.map((level) => level.label);
  private minComplexity = 0;
  private maxComplexity = chaosLevels.length - 1;
  /** How many clocks the server says it knows, until it says. */
  private timeControlCount = timeControls.length;
  /** What the player last asked to be matched at. */
  private request:
    | { complexity: number; timeControl: number; name: string }
    | null = null;
  /**
   * Whether a search is wanted. A socket that is still opening joins when it
   * opens, so this is what keeps a search that was called off in the meantime
   * from joining after all.
   */
  private searching = false;

  constructor(options: MatchmakingSessionOptions) {
    this.options = options;
  }

  get status(): MatchmakingStatus {
    return this.currentStatus;
  }

  /** The game being played, or `null` when there is none. */
  get currentGame(): OnlineGame | null {
    return this.game;
  }

  /** Calls `listener` with the status now, and again whenever it changes. */
  watch(listener: (status: MatchmakingStatus) => void): () => void {
    this.watchers.add(listener);
    listener(this.currentStatus);
    return () => {
      this.watchers.delete(listener);
    };
  }

  /** The level the player asked for, named the way the server names it. */
  get complexityLabel(): string {
    const complexity = this.request?.complexity ?? 0;
    return this.labels[complexity] ?? chaosLevels[0].label;
  }

  /** The clock the player asked for, named the way the slider names it. */
  get timeControlLabel(): string {
    const index = this.clampClock(this.request?.timeControl ?? 0);
    return timeControlLabel(timeControls[index]);
  }

  /**
   * Asks to be matched at a chaos level with a clock, opening the socket when
   * there is not one already. Asking again while queued only updates the
   * preference, and keeps the player's place in the queue.
   */
  queue(complexity: number, timeControl: number, name: string): void {
    this.request = {
      complexity: this.clamp(complexity),
      timeControl: this.clampClock(timeControl),
      name,
    };
    this.searching = true;
    if (this.currentStatus.state !== "queued") {
      this.setStatus({ state: "connecting" });
    }

    const client = this.client;
    if (!client || client.closed) {
      this.connect();
      return;
    }
    // A socket that is still opening joins when it opens instead, so the join
    // always follows whatever the player did before it.
    if (client.isOpen) {
      client.join(this.request.complexity, this.request.timeControl, name);
    }
  }

  /**
   * Leaves the queue, keeping the socket open for a later search, and takes a
   * failed search's message down with it.
   */
  cancel(): void {
    if (this.currentStatus.state === "idle") return;
    this.searching = false;
    if (this.client?.isOpen) this.client.cancelQueue();
    this.setStatus({ state: "idle" });
  }

  private connect(): void {
    // Where to connect is a deployment's decision. A build that was not given
    // one says so, rather than opening a socket to an address nobody chose.
    const url = this.options.url ?? matchmakingUrl;
    if (url === undefined) {
      this.fail(
        "Matchmaking URL not configured.",
      );
      return;
    }

    const client = new MatchmakingClient(
      url,
      {
        onMessage: (message) => this.receive(message),
        onOpen: () => this.joinNow(client),
        onClose: () => this.receiveClose(),
      },
      this.options.createSocket,
    );
    this.client = client;
    client.ready.catch((error: unknown) => {
      if (this.client !== client) return;
      this.client = null;
      this.setStatus({ state: "error", message: describe(error) });
    });
  }

  /** Joins the queue on a socket that has just opened, if it is still wanted. */
  private joinNow(client: MatchmakingClient): void {
    if (this.client !== client) return;
    const request = this.request;
    if (!this.searching || !request) return;
    client.join(request.complexity, request.timeControl, request.name);
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.receiveWelcome(message);
        return;
      case "queued":
        this.setStatus({ state: "queued", waiting: message.waiting });
        return;
      case "queueCancelled":
        this.setStatus({ state: "idle" });
        return;
      case "matched":
        this.startGame(message);
        return;
      case "ping":
        // The keepalive is answered by the client, not by the session.
        return;
      case "error":
        // During a game the board is the only thing on screen, so the message
        // belongs there; otherwise it ends the search.
        if (this.game) {
          this.game.notice(message.message);
          return;
        }
        this.setStatus({ state: "error", message: message.message });
        return;
      case "gameOver":
      case "opponentLeft":
        // The game is over, so the session forgets it. The screen keeps its own
        // reference until the player asks for another opponent.
        this.game?.receive(message);
        this.game = null;
        return;
      case "moved":
      case "clock":
      case "moveRejected":
      case "drawOffered":
        this.game?.receive(message);
        return;
    }
  }

  private receiveWelcome(
    message: Extract<ServerMessage, { type: "welcome" }>,
  ): void {
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      this.fail(
        `This page speaks protocol ${PROTOCOL_VERSION} but the matchmaking ` +
          `server speaks ${message.protocolVersion}. Reload the page to pick ` +
          `up the current version.`,
      );
      return;
    }

    this.labels = message.complexityLabels;
    this.minComplexity = message.minComplexity;
    this.maxComplexity = message.maxComplexity;
    // A deployment may offer fewer clocks than this build knows about, so the
    // ones it does offer are the only ones worth asking for.
    if (message.timeControlLabels.length > 0) {
      this.timeControlCount = message.timeControlLabels.length;
    }
    if (this.request) {
      this.request = {
        ...this.request,
        complexity: this.clamp(this.request.complexity),
        timeControl: this.clampClock(this.request.timeControl),
      };
    }
    // The level may have been narrowed, so anything showing it is told again.
    this.setStatus(this.currentStatus);
  }

  private startGame(
    message: Extract<ServerMessage, { type: "matched" }>,
  ): void {
    const game = new Game(
      {
        color: message.color,
        playerName: this.request?.name ?? "",
        opponentName: message.opponentName,
        complexity: message.complexity,
        complexityLabel: message.complexityLabel,
        timeControl: message.timeControl,
        board: message.board,
      },
      {
        move: (request) => this.client?.move(request),
        resign: () => this.client?.resign(),
        abort: () => this.client?.abort(),
        offerDraw: () => this.client?.offerDraw(),
      },
    );

    this.game = game;
    this.searching = false;
    this.setStatus({ state: "idle" });
    this.options.onGame(game);
  }

  /** Gives up on the connection, reporting why where the player can see it. */
  private fail(message: string): void {
    this.client?.dispose();
    this.client = null;
    this.setStatus({ state: "error", message });
  }

  private receiveClose(): void {
    this.client = null;

    const game = this.game;
    this.game = null;
    if (game) {
      game.disconnected();
      this.setStatus({ state: "idle" });
      return;
    }

    if (
      this.currentStatus.state === "connecting" ||
      this.currentStatus.state === "queued"
    ) {
      this.setStatus({
        state: "error",
        message: "The connection to the matchmaking server was lost.",
      });
    }
  }

  private setStatus(status: MatchmakingStatus): void {
    this.currentStatus = status;
    for (const watcher of [...this.watchers]) watcher(status);
  }

  /** The nearest level to `complexity` the server has said it accepts. */
  private clamp(complexity: number): number {
    const level = Number.isFinite(complexity) ? Math.round(complexity) : 0;
    return Math.min(this.maxComplexity, Math.max(this.minComplexity, level));
  }

  /** The nearest clock to `index` the server has said it knows. */
  private clampClock(index: number): number {
    return Math.min(clampTimeControl(index), this.timeControlCount - 1);
  }
}

/** One game, and the connection it is played over. */
class Game implements OnlineGame {
  readonly color: Color;
  readonly playerName: string;
  readonly opponentName: string;
  readonly complexity: number;
  readonly complexityLabel: string;
  readonly timeControl: TimeControlSpec;
  readonly board: SerializedBoardState;

  private readonly sender: GameSender;
  private listener: GameListener | null = null;

  constructor(
    init: {
      color: Color;
      playerName: string;
      opponentName: string;
      complexity: number;
      complexityLabel: string;
      timeControl: TimeControlSpec;
      board: SerializedBoardState;
    },
    sender: GameSender,
  ) {
    this.color = init.color;
    this.playerName = init.playerName;
    this.opponentName = init.opponentName;
    this.complexity = init.complexity;
    this.complexityLabel = init.complexityLabel;
    this.timeControl = init.timeControl;
    this.board = init.board;
    this.sender = sender;
  }

  listen(listener: GameListener): void {
    this.listener = listener;
  }

  requestMove(request: MoveRequest): void {
    this.sender.move(request);
  }

  resign(): void {
    this.sender.resign();
  }

  abort(): void {
    this.sender.abort();
  }

  offerDraw(): void {
    this.sender.offerDraw();
  }

  /** Reports a message the session decided belongs to this game. */
  receive(
    message:
      | Extract<ServerMessage, { type: "moved" }>
      | Extract<ServerMessage, { type: "clock" }>
      | Extract<ServerMessage, { type: "moveRejected" }>
      | Extract<ServerMessage, { type: "gameOver" }>
      | Extract<ServerMessage, { type: "opponentLeft" }>
      | Extract<ServerMessage, { type: "drawOffered" }>,
  ): void {
    const listener = this.listener;
    if (!listener) return;

    switch (message.type) {
      case "moved":
        listener.moved(message.board, message.pgn, message.inCheck, message.color);
        return;
      case "clock":
        listener.clock(message.white, message.black, message.running);
        return;
      case "moveRejected":
        listener.moveRejected(message.rejection);
        return;
      case "drawOffered":
        listener.drawOffered(message.color);
        return;
      case "gameOver":
        listener.gameOver(message.status, message.winner);
        return;
      case "opponentLeft":
        listener.opponentLeft(message.winner);
        return;
    }
  }

  /** Reports that the connection went away mid-game. */
  disconnected(): void {
    this.listener?.disconnected();
  }

  /** Reports something the server said that the board should show. */
  notice(text: string): void {
    this.listener?.notice(text);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
