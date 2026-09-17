import {
  parseServerMessage,
  type ClientMessage,
  type MoveRequest,
  type ServerMessage,
} from "./protocol.ts";

/** What the client reports back to the screen that owns it. */
export interface MatchmakingHandlers {
  /** Every message the server sent, except the keepalives answered here. */
  onMessage(message: ServerMessage): void;
  /**
   * The socket is up, so what was held back has been sent. Anything the owner
   * wanted to say before it opened can be said here instead of waiting on
   * {@link MatchmakingClient.ready}.
   */
  onOpen?(): void;
  /**
   * The socket closed on its own, so nothing further will arrive. A socket that
   * never opened reports through {@link MatchmakingClient.ready} instead.
   */
  onClose(): void;
}

/** Opens the socket to talk over. Replaced by a stand-in in tests. */
export type SocketFactory = (url: string) => WebSocket;

/**
 * One player's end of a connection to the matchmaking server.
 *
 * The class is transport only: it parses what arrives, answers the server's
 * keepalives, and queues messages sent before the socket is open. What the
 * messages mean is for the screen above it to decide.
 */
export class MatchmakingClient {
  /**
   * Resolves once the socket is open, and rejects when it cannot be reached.
   * Messages sent before then are held rather than dropped.
   */
  readonly ready: Promise<void>;

  /**
   * Whether the socket has given up. A closed client carries nothing further,
   * so its owner has to make a new one to talk to the server again.
   */
  get closed(): boolean {
    return this.state === "done";
  }

  /** Whether the socket is up, so what is sent now is sent at once. */
  get isOpen(): boolean {
    return this.state === "open";
  }

  private readonly socket: WebSocket;
  private readonly handlers: MatchmakingHandlers;
  private readonly unsent: string[] = [];
  private state: "opening" | "open" | "done" = "opening";
  /** Whether the owner closed the socket on purpose. */
  private disposed = false;

  constructor(
    url: string,
    handlers: MatchmakingHandlers,
    createSocket: SocketFactory = (address) => new WebSocket(address),
  ) {
    this.handlers = handlers;
    this.socket = createSocket(url);

    this.ready = new Promise<void>((resolve, reject) => {
      this.socket.addEventListener("open", () => {
        this.state = "open";
        for (const frame of this.unsent.splice(0)) this.socket.send(frame);
        resolve();
        // A handler registered here sends at once, after the held-back frames,
        // so joining does not have to wait a turn of the event loop.
        this.handlers.onOpen?.();
      });
      this.socket.addEventListener("error", () => {
        this.abandon();
        reject(new Error(`Could not reach the matchmaking server at ${url}.`));
      });
    });

    this.socket.addEventListener("message", (event) => {
      this.receive(event.data);
    });
    this.socket.addEventListener("close", () => {
      const wasOpen = this.state === "open";
      this.abandon();
      if (wasOpen && !this.disposed) this.handlers.onClose();
    });
  }

  /**
   * Asks to be matched at `complexity` and `timeControl`. Sending it again only
   * updates the preference. `playerId` is the identifier this browser plays
   * under, which the server records and echoes back.
   */
  join(
    complexity: number,
    timeControl: number,
    name?: string,
    playerId?: string,
  ): void {
    const message: ClientMessage = { type: "join", complexity, timeControl };
    if (name !== undefined && name.trim() !== "") message.name = name;
    if (playerId !== undefined) message.playerId = playerId;
    this.send(message);
  }

  /**
   * Asks to take back a seat at a game that is still running, which is how a
   * reloaded page or a reconnected socket picks a game up again.
   */
  rejoin(gameId: string, playerId: string): void {
    this.send({ type: "rejoin", gameId, playerId });
  }

  /** Leaves the queue without waiting for an opponent. */
  cancelQueue(): void {
    this.send({ type: "cancelQueue" });
  }

  /** Asks to play a move. The board changes when the server accepts it. */
  move(request: MoveRequest): void {
    this.send({
      type: "move",
      pieceId: request.pieceId,
      from: request.from,
      to: request.to,
      promotion: request.promotion,
    });
  }

  /** Ends the game in the opponent's favour. */
  resign(): void {
    this.send({ type: "resign" });
  }

  /**
   * Calls the game off. Only allowed before this player has moved, and it ends
   * the game with no result rather than in a loss.
   */
  abort(): void {
    this.send({ type: "abort" });
  }

  /**
   * Offers a draw. The game is drawn once the opponent offers one too, so this
   * is a standing offer rather than a question that needs an answer.
   */
  offerDraw(): void {
    this.send({ type: "offerDraw" });
  }

  /** Takes back a draw offer this player made, leaving the game running. */
  cancelDraw(): void {
    this.send({ type: "cancelDraw" });
  }

  /**
   * Closes the socket because the screen is going away, without reporting the
   * close as something that went wrong.
   */
  dispose(): void {
    this.disposed = true;
    this.unsent.length = 0;
    try {
      this.socket.close();
    } catch {
      // Closing a socket that never opened has nothing left to do.
    }
  }

  /** Sends `message`, holding it back until the socket is ready for it. */
  private send(message: ClientMessage): void {
    if (this.disposed || this.state === "done") return;
    const frame = JSON.stringify(message);
    if (this.state === "open") this.socket.send(frame);
    else this.unsent.push(frame);
  }

  /** Gives up on the socket, which will carry nothing further. */
  private abandon(): void {
    this.state = "done";
    this.unsent.length = 0;
  }

  private receive(data: unknown): void {
    const message = parseServerMessage(data);
    if (message === undefined) {
      console.warn("Ignoring a message this client cannot read:", data);
      return;
    }

    // The keepalive exists to be answered; the screen has no interest in it.
    if (message.type === "ping") {
      this.send({ type: "pong" });
      return;
    }

    try {
      this.handlers.onMessage(message);
    } catch (error) {
      // One message this client cannot make sense of must not take the
      // socket's event handling down with it.
      console.error("Failed to handle a matchmaking message:", error);
    }
  }
}
