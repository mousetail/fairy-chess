import { chaosLevels } from "../replacement-rules.ts";
import { MatchmakingClient, type SocketFactory } from "./client.ts";
import { matchmakingUrl } from "./config.ts";
import { loadPlayerId, savePlayerId } from "./player-identity.ts";
import {
  type ClockState,
  type Color,
  type GameHistory,
  type GameOverStatus,
  type GameResult,
  type MoveRejection,
  type MoveRequest,
  PROTOCOL_VERSION,
  type SerializedPlay,
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
  /**
   * The opponent's connection dropped. The game is not over: their clock runs
   * on, and this browser can wait for them to come back.
   */
  opponentAway(color: Color): void;
  /** The opponent came back and is playing again. */
  opponentBack(color: Color): void;
  /** Someone offered a draw, naming the side that offered. */
  drawOffered(color: Color): void;
  /** Someone took their draw offer back, naming the side that did. */
  drawCancelled(color: Color): void;
  /** Something the server said that the board should show as a message. */
  notice(text: string): void;
  /** This browser lost its connection and is trying to take its seat back. */
  resuming(attempt: number): void;
  /**
   * The connection is back and the seat was taken: the board is replaced with
   * the game the server is holding, which is where the game carried on while
   * this browser was away.
   */
  resumed(
    board: SerializedBoardState,
    clock: ClockState,
    drawOffers: Color[],
    history: GameHistory,
  ): void;
  /** The connection dropped and could not be restored. */
  disconnected(): void;
}

/** A game in progress, as the app and the board see it. */
export interface OnlineGame {
  /** The UUID the game is known by, which names it in the address bar. */
  readonly gameId: string;
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
  /** The position to start from: the server laid it out, or held it until now. */
  readonly board: SerializedBoardState;
  /** What each clock had left when the game was handed over. */
  readonly clock: ClockState;
  /** The sides with a draw offer standing at hand-over, if any. */
  readonly drawOffers: Color[];
  /** The game from its opening, so the move log can be put back. */
  readonly history: GameHistory;
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
  /** Takes back this browser's draw offer, leaving the game running. */
  cancelDraw(): void;
}

/** How a game sends what the player asks for. */
interface GameSender {
  move(request: MoveRequest): void;
  resign(): void;
  abort(): void;
  offerDraw(): void;
  cancelDraw(): void;
}

/**
 * A finished game, as the app and the review board see it.
 *
 * It is not playable: nobody sits at it, and the board it is shown on is only
 * for looking at the moves again. `color` is the side the viewer played, or
 * `null` when they did not play this game and are only reading it.
 */
export interface ReviewedGame {
  readonly gameId: string;
  readonly color: Color | null;
  readonly whiteName: string;
  readonly blackName: string;
  readonly complexity: number;
  readonly complexityLabel: string;
  readonly timeControl: TimeControlSpec;
  readonly result: GameResult;
  /** The position the game started from. */
  readonly initialBoard: SerializedBoardState;
  /** Every move, in order, ready to be applied to the opening position. */
  readonly moves: SerializedPlay[];
}

export interface MatchmakingSessionOptions {
  /**
   * Called when a game starts, so the app can put the board on screen. The
   * session has already cleared its own state by the time this runs.
   */
  onGame(game: OnlineGame): void;
  /**
   * Called when a finished game is asked for by its id, so the app can put it on
   * screen for reading. A game shared by its link arrives here rather than at
   * {@link onGame}, since there is nobody to play against.
   */
  onReview?(game: ReviewedGame): void;
  /**
   * The server to talk to, in place of the one the build was made with. Tests
   * set it; a blank value stands for a build that was told of none.
   */
  url?: string;
  /** How sockets are made; overridable so tests need no server. */
  createSocket?: SocketFactory;
  /**
   * The identifier this browser plays under. Read from local storage unless a
   * test hands one in, so a game can be rejoined without a browser.
   */
  playerId?: string;
  /** How long to wait between attempts to take a seat back. */
  reconnectDelayMs?: number;
  /** How many times to try before giving the game up. */
  maxReconnectAttempts?: number;
}

/** How long a broken connection waits before trying to take its seat back. */
const defaultReconnectDelayMs = 3000;

/** How many times a broken connection tries before the game is left alone. */
const defaultMaxReconnectAttempts = 40;

export class MatchmakingSession {
  private readonly options: MatchmakingSessionOptions;
  private readonly watchers = new Set<(status: MatchmakingStatus) => void>();
  private currentStatus: MatchmakingStatus = { state: "idle" };
  private client: MatchmakingClient | null = null;
  private game: Game | null = null;
  /** The identifier this browser plays under, kept in local storage. */
  private playerId: string;
  /**
   * The game this session belongs to, whether it is being played or is being
   * taken back. It is what a reconnecting socket asks to rejoin, and what a
   * reloaded page reads from the address bar.
   */
  private gameId: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
  /**
   * The moment the search now running began. A screen that shows how long the
   * player has been waiting counts from this, so one put up in the middle of a
   * search shows the whole wait rather than starting again from nothing.
   */
  private beganAt: number | null = null;

  constructor(options: MatchmakingSessionOptions) {
    this.options = options;
    this.playerId = options.playerId ?? loadPlayerId();
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

  /**
   * When the search now running began, or `null` when there is none. The count
   * starts as soon as the player asks to be matched, before the queue answers.
   */
  get searchStartedAt(): number | null {
    const state = this.currentStatus.state;
    return state === "connecting" || state === "queued" ? this.beganAt : null;
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
      // A search that has not reached the queue yet is a new one, so its clock
      // starts here. One already queued keeps both its place and its clock when
      // the player only changes their preference.
      this.beganAt = Date.now();
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
      client.join(
        this.request.complexity,
        this.request.timeControl,
        name,
        this.playerId,
      );
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

  /**
   * Takes back the seat this browser holds at the game named by `gameId`, which
   * is how a page that was reloaded picks up the game it was playing. The game
   * is put on screen as soon as the server answers.
   */
  resume(gameId: string): void {
    if (this.gameId !== null || this.game !== null) return;
    this.gameId = gameId;
    this.searching = false;
    this.beganAt = null;
    this.setStatus({ state: "connecting" });
    this.connect();
  }

  private connect(): void {
    // Where to connect is a deployment's decision. A build that was not given
    // one says so, rather than opening a socket to an address nobody chose.
    const url = this.options.url ?? matchmakingUrl;
    if (url === undefined) {
      this.fail("Matchmaking URL not configured.");
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
      // A game this browser still belongs to is worth trying again; a search
      // that never reached the server is simply reported.
      if (this.gameId !== null) {
        this.scheduleReconnect();
        return;
      }
      this.setStatus({ state: "error", message: describe(error) });
    });
  }

  /**
   * Joins the queue on a socket that has just opened, or takes back the seat at
   * a game this session still belongs to, if either is still wanted.
   */
  private joinNow(client: MatchmakingClient): void {
    if (this.client !== client) return;
    if (this.gameId !== null) {
      client.rejoin(this.gameId, this.playerId);
      return;
    }
    const request = this.request;
    if (!this.searching || !request) return;
    client.join(
      request.complexity,
      request.timeControl,
      request.name,
      this.playerId,
    );
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
      case "resumed":
        this.resumeGame(message);
        return;
      case "reviewed":
        this.reviewGame(message);
        return;
      case "ping":
        // The keepalive is answered by the client, not by the session.
        return;
      case "error":
        // During a game the board is the only thing on screen, so the message
        // belongs there; a rejoin that was refused ends the attempt.
        if (this.game) {
          this.game.notice(message.message);
          return;
        }
        if (this.gameId !== null) {
          this.fail(message.message);
          return;
        }
        this.setStatus({ state: "error", message: message.message });
        return;
      case "gameOver":
        this.game?.receive(message);
        this.game = null;
        this.gameId = null;
        this.cancelReconnect();
        return;
      case "opponentAway":
      case "opponentBack":
      case "moved":
      case "clock":
      case "moveRejected":
      case "drawOffered":
      case "drawCancelled":
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
    this.adoptPlayerId(message.playerId);
    this.gameId = message.gameId;

    const game = new Game(
      {
        gameId: message.gameId,
        color: message.color,
        playerName: this.request?.name ?? "",
        opponentName: message.opponentName,
        complexity: message.complexity,
        complexityLabel: message.complexityLabel,
        timeControl: message.timeControl,
        board: message.board,
        clock: {
          white: message.timeControl.initialMs,
          black: message.timeControl.initialMs,
          running: null,
        },
        drawOffers: [],
        // A game that has just started has no moves to put back.
        history: { initialBoard: message.board, moves: [] },
      },
      this.sender(),
    );

    this.game = game;
    this.searching = false;
    this.setStatus({ state: "idle" });
    this.options.onGame(game);
  }

  /**
   * Takes back a seat, either for a page that has just loaded or for a socket
   * that has just reconnected. A board already on screen is told the position
   * the server is holding; otherwise the game is handed over as a new one.
   */
  private resumeGame(
    message: Extract<ServerMessage, { type: "resumed" }>,
  ): void {
    this.adoptPlayerId(message.playerId);
    this.gameId = message.gameId;
    this.reconnectAttempts = 0;
    this.cancelReconnect();
    this.searching = false;

    const existing = this.game;
    if (existing) {
      existing.applyResume(
        message.board,
        message.clock,
        message.drawOffers,
        message.history,
      );
      this.setStatus({ state: "idle" });
      return;
    }

    const game = new Game(
      {
        gameId: message.gameId,
        color: message.color,
        playerName: message.playerName,
        opponentName: message.opponentName,
        complexity: message.complexity,
        complexityLabel: message.complexityLabel,
        timeControl: message.timeControl,
        board: message.board,
        clock: message.clock,
        drawOffers: message.drawOffers,
        history: message.history,
      },
      this.sender(),
    );

    this.game = game;
    this.setStatus({ state: "idle" });
    this.options.onGame(game);
  }

  /**
   * Hands a finished game to the app to be read, and forgets it: there is no
   * seat at it and nothing to reconnect to.
   */
  private reviewGame(
    message: Extract<ServerMessage, { type: "reviewed" }>,
  ): void {
    this.cancelReconnect();
    this.reconnectAttempts = 0;
    this.gameId = null;
    this.game = null;
    this.searching = false;
    this.setStatus({ state: "idle" });
    this.options.onReview?.({
      gameId: message.gameId,
      color: message.color,
      whiteName: message.whiteName,
      blackName: message.blackName,
      complexity: message.complexity,
      complexityLabel: message.complexityLabel,
      timeControl: message.timeControl,
      result: message.result,
      initialBoard: message.initialBoard,
      moves: message.moves,
    });
  }

  /** Everything the game sends on this browser's behalf. */
  private sender(): GameSender {
    return {
      move: (request) => this.client?.move(request),
      resign: () => this.client?.resign(),
      abort: () => this.client?.abort(),
      offerDraw: () => this.client?.offerDraw(),
      cancelDraw: () => this.client?.cancelDraw(),
    };
  }

  /** Keeps the identifier the server answered with, in case it made a new one. */
  private adoptPlayerId(playerId: string): void {
    if (playerId === this.playerId) return;
    this.playerId = playerId;
    savePlayerId(playerId);
  }

  /** Gives up on the connection, reporting why where the player can see it. */
  private fail(message: string): void {
    this.client?.dispose();
    this.client = null;
    this.cancelReconnect();
    this.gameId = null;
    this.setStatus({ state: "error", message });
  }

  private receiveClose(): void {
    this.client = null;

    // A game this browser belongs to outlives the socket: the server keeps the
    // seat, so the connection is opened again and the seat taken back.
    if (this.gameId !== null) {
      this.scheduleReconnect();
      return;
    }

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

  /**
   * Arranges another attempt at taking the seat back, telling the board so it
   * can say what is happening. Running out of attempts ends the game here: the
   * seat is still held on the server, so reloading the page can still find it.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;

    const attempts = this.options.maxReconnectAttempts ??
      defaultMaxReconnectAttempts;
    if (this.reconnectAttempts >= attempts) {
      this.giveUpReconnecting();
      return;
    }

    this.reconnectAttempts++;
    this.game?.resuming(this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.client === null) this.connect();
    }, this.options.reconnectDelayMs ?? defaultReconnectDelayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private giveUpReconnecting(): void {
    this.cancelReconnect();
    this.reconnectAttempts = 0;
    const game = this.game;
    this.game = null;
    this.gameId = null;
    if (game) {
      // The board is on screen, so it is told the game can go no further.
      game.disconnected();
      this.setStatus({ state: "idle" });
      return;
    }
    // Nothing was on screen: the page was trying to take a seat back when it
    // loaded, and the server could not be reached.
    this.setStatus({
      state: "error",
      message: "The connection to the matchmaking server was lost.",
    });
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
  readonly gameId: string;
  readonly color: Color;
  readonly playerName: string;
  readonly opponentName: string;
  readonly complexity: number;
  readonly complexityLabel: string;
  readonly timeControl: TimeControlSpec;
  readonly board: SerializedBoardState;
  readonly history: GameHistory;

  private readonly sender: GameSender;
  private listener: GameListener | null = null;
  private clockState: ClockState;
  private offeredDraws: Color[];

  constructor(
    init: {
      gameId: string;
      color: Color;
      playerName: string;
      opponentName: string;
      complexity: number;
      complexityLabel: string;
      timeControl: TimeControlSpec;
      board: SerializedBoardState;
      clock: ClockState;
      drawOffers: Color[];
      history: GameHistory;
    },
    sender: GameSender,
  ) {
    this.gameId = init.gameId;
    this.color = init.color;
    this.playerName = init.playerName;
    this.opponentName = init.opponentName;
    this.complexity = init.complexity;
    this.complexityLabel = init.complexityLabel;
    this.timeControl = init.timeControl;
    this.board = init.board;
    this.clockState = init.clock;
    this.offeredDraws = [...init.drawOffers];
    this.history = init.history;
    this.sender = sender;
  }

  /** What each clock had left when the game was last taken back. */
  get clock(): ClockState {
    return this.clockState;
  }

  /** The sides with a draw offer standing at hand-over. */
  get drawOffers(): Color[] {
    return this.offeredDraws;
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

  cancelDraw(): void {
    this.sender.cancelDraw();
  }

  /**
   * Reports that the seat was taken back, replacing what the board shows with
   * the position and clocks the server is holding.
   */
  applyResume(
    board: SerializedBoardState,
    clock: ClockState,
    drawOffers: Color[],
    history: GameHistory,
  ): void {
    this.clockState = clock;
    this.offeredDraws = [...drawOffers];
    this.listener?.resumed(board, clock, drawOffers, history);
  }

  /** Reports that the connection went away and is being reopened. */
  resuming(attempt: number): void {
    this.listener?.resuming(attempt);
  }

  /** Reports a message the session decided belongs to this game. */
  receive(
    message:
      | Extract<ServerMessage, { type: "moved" }>
      | Extract<ServerMessage, { type: "clock" }>
      | Extract<ServerMessage, { type: "moveRejected" }>
      | Extract<ServerMessage, { type: "gameOver" }>
      | Extract<ServerMessage, { type: "opponentAway" }>
      | Extract<ServerMessage, { type: "opponentBack" }>
      | Extract<ServerMessage, { type: "drawOffered" }>
      | Extract<ServerMessage, { type: "drawCancelled" }>,
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
      case "drawCancelled":
        listener.drawCancelled(message.color);
        return;
      case "opponentAway":
        listener.opponentAway(message.color);
        return;
      case "opponentBack":
        listener.opponentBack(message.color);
        return;
      case "gameOver":
        listener.gameOver(message.status, message.winner);
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