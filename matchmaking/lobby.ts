import { invertColor } from "../src/chess-board.ts";
import { serializeMove } from "../src/online/serialization.ts";
import type {
  ClientMessage,
  Color,
  GameResult,
  ServerMessage,
  TimeControlSpec,
} from "../src/online/protocol.ts";
import {
  clampTimeControl,
  timeControlLabel,
  timeControlMs,
  timeControls,
} from "../src/online/time-controls.ts";
import { chaosLevels } from "../src/replacement-rules.ts";
import { GameClock } from "./clock.ts";
import { GameSession, type MoveRequest } from "./game-session.ts";
import {
  canMatch,
  chooseComplexity,
  chooseTimeControl,
  clampComplexity,
  type Preference,
} from "./matchmaking.ts";

/** What the lobby needs from a connected player. */
export interface Client {
  readonly id: string;
  send(message: ServerMessage): void;
}

/** A player waiting for an opponent. */
interface WaitingPlayer extends Preference {
  client: Client;
  name: string;
}

/** A game in progress, together with the players sitting at it. */
interface Room {
  id: string;
  session: GameSession;
  clock: GameClock;
  clients: Record<Color, Client>;
  names: Record<Color, string>;
  /**
   * The sides that have offered a draw. An offer stands until a move is played,
   * which clears both sides' offers, or until the side that made it takes it
   * back.
   */
  drawOffers: Set<Color>;
  /** When the players were last sent their clocks, so they are not spammed. */
  lastClockAt: number;
}

export interface LobbyOptions {
  /** Overridable for tests, which want a deterministic colour assignment. */
  random?: () => number;
  /** The current time, overridable so a test can drive the clocks itself. */
  now?: () => number;
}

/** The longest name accepted from a client. */
const maxNameLength = 24;

/**
 * How often the players are sent their clocks while one is running.
 *
 * The server is the authority on the time, so the clocks are sent again as they
 * run rather than only when they change: a client that fell behind — a
 * backgrounded tab, whose timers the browser throttles — catches up here.
 */
const clockIntervalMs = 1000;

/**
 * Pairs waiting players and runs the games they are paired into.
 *
 * Everything is held in memory, which is what lets the lobby stay simple: a
 * player is either waiting, at a table, or gone. That also means the server has
 * to run as a single instance, since two instances would keep two separate
 * queues and could not pair their players with each other.
 */
export class Lobby {
  private readonly waiting = new Map<string, WaitingPlayer>();
  private readonly rooms = new Map<string, Room>();
  private readonly roomByClient = new Map<string, Room>();
  private readonly random: () => number;
  private readonly now: () => number;
  private nextGameNumber = 1;

  constructor(options: LobbyOptions = {}) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  /** How many players are waiting for an opponent. */
  get waitingCount(): number {
    return this.waiting.size;
  }

  /** How many games are being played. */
  get gameCount(): number {
    return this.rooms.size;
  }

  handleMessage(client: Client, message: ClientMessage): void {
    switch (message.type) {
      case "join":
        this.join(client, message);
        return;
      case "cancelQueue":
        this.cancelQueue(client);
        return;
      case "move":
        this.move(client, message);
        return;
      case "resign":
        this.resign(client);
        return;
      case "abort":
        this.abort(client);
        return;
      case "offerDraw":
        this.offerDraw(client);
        return;
      case "cancelDraw":
        this.cancelDraw(client);
        return;
      case "pong":
        // The connection layer watches for the traffic; there is nothing to do.
        return;
    }
  }

  /**
   * Puts `client` in the queue, pairing it on the spot when someone compatible
   * is already waiting.
   *
   * A player who is already waiting only updates their preference, keeping
   * their place, so changing a setting and asking to play again does not send
   * them to the back of the queue.
   */
  join(
    client: Client,
    options: { complexity: number; timeControl: number; name?: string },
  ): void {
    if (this.roomByClient.has(client.id)) {
      this.fail(client, "You are already playing a game.");
      return;
    }

    const complexity = clampComplexity(options.complexity);
    const timeControl = clampTimeControl(options.timeControl);
    const waiting: WaitingPlayer = {
      client,
      complexity,
      timeControl,
      name: sanitizeName(options.name),
    };
    this.waiting.set(client.id, waiting);

    const opponent = this.findOpponent(waiting, client.id);
    if (!opponent) {
      client.send({
        type: "queued",
        complexity,
        timeControl,
        waiting: this.waitingCount,
      });
      return;
    }

    this.waiting.delete(opponent.client.id);
    this.waiting.delete(client.id);
    this.startGame(opponent, waiting);
  }

  /** Takes `client` out of the queue, if it is in it. */
  cancelQueue(client: Client): void {
    if (this.waiting.delete(client.id)) {
      client.send({ type: "queueCancelled" });
    }
  }

  /** Plays a move for `client`, or tells it why the move cannot be played. */
  move(
    client: Client,
    message: Extract<ClientMessage, { type: "move" }>,
  ): void {
    const room = this.roomByClient.get(client.id);
    if (!room) {
      this.fail(client, "You are not in a game yet.");
      return;
    }

    const now = this.now();

    // A move can only arrive after its clock ran out if it was in flight when
    // it did, so the flag is checked before the move rather than after it: a
    // player who is out of time does not get to play one last move.
    const late = room.clock.flagged(now);
    if (late !== null) {
      this.endGame(room, room.session.timeout(late));
      return;
    }

    const color = this.colorOf(room, client.id);
    const request: MoveRequest = {
      pieceId: message.pieceId,
      from: message.from,
      to: message.to,
      promotion: message.promotion,
    };
    const outcome = room.session.play(color, request);

    if (!outcome.ok) {
      client.send({ type: "moveRejected", rejection: outcome.rejection });
      return;
    }

    // The position has moved on, so an offer made before the move no longer
    // stands. The clients clear theirs when this `moved` reaches them.
    room.drawOffers.clear();

    this.broadcast(room, {
      type: "moved",
      color,
      move: serializeMove(outcome.applied.move),
      pgn: outcome.applied.pgn,
      board: outcome.applied.board,
      inCheck: outcome.applied.inCheck,
    });

    if (outcome.result) {
      this.endGame(room, outcome.result);
      return;
    }

    room.clock.afterMove(color, invertColor(color), now);
    this.sendClock(room, now);
  }

  /** Ends `client`'s game in its opponent's favour. */
  resign(client: Client): void {
    const room = this.roomByClient.get(client.id);
    if (!room) {
      this.fail(client, "You are not in a game yet.");
      return;
    }

    this.endGame(room, room.session.resign(this.colorOf(room, client.id)));
  }

  /**
   * Calls `client`'s game off, which is only allowed before it has moved.
   *
   * Nothing has been risked while a player's first move is still ahead of them,
   * so there is nothing to lose by calling the game off; once they have moved,
   * giving up has to be a resignation.
   */
  abort(client: Client): void {
    const room = this.roomByClient.get(client.id);
    if (!room) {
      this.fail(client, "You are not in a game yet.");
      return;
    }

    if (room.clock.hasMoved(this.colorOf(room, client.id))) {
      this.fail(client, "You have already moved, so resign instead.");
      return;
    }

    this.endGame(room, room.session.abort());
  }

  /**
   * Records `client`'s offer of a draw, and draws the game when the opponent
   * has offered one as well.
   *
   * Both players are told who offered, so the one that did does not mistake its
   * own offer for the opponent's. An offer only stands until a move is played,
   * which clears both sides' offers.
   */
  offerDraw(client: Client): void {
    const room = this.roomByClient.get(client.id);
    if (!room) {
      this.fail(client, "You are not in a game yet.");
      return;
    }

    const color = this.colorOf(room, client.id);
    // Offering twice is the same as offering once, so the second is ignored
    // rather than treated as the opponent's answer.
    if (room.drawOffers.has(color)) return;
    room.drawOffers.add(color);

    this.broadcast(room, { type: "drawOffered", color });

    if (!room.drawOffers.has(invertColor(color))) return;
    this.endGame(room, room.session.draw());
  }

  /**
   * Takes back `client`'s draw offer, which leaves the game running.
   *
   * Both players are told, so the opponent's board stops treating the offer as
   * one waiting to be accepted. A player with no offer standing has nothing to
   * take back, so nothing is said about it.
   */
  cancelDraw(client: Client): void {
    const room = this.roomByClient.get(client.id);
    if (!room) {
      this.fail(client, "You are not in a game yet.");
      return;
    }

    const color = this.colorOf(room, client.id);
    if (!room.drawOffers.delete(color)) return;

    this.broadcast(room, { type: "drawCancelled", color });
  }

  /**
   * Checks every game's clocks.
   *
   * A game whose side to move has run out of time is lost, and the players of
   * every other game are sent their clocks again so a client that fell behind
   * catches up. The caller runs this on a timer; a test calls it directly.
   */
  tick(now: number = this.now()): void {
    for (const room of [...this.rooms.values()]) {
      const late = room.clock.flagged(now);
      if (late !== null) {
        this.endGame(room, room.session.timeout(late));
        continue;
      }
      if (
        room.clock.runningColor !== null &&
        now - room.lastClockAt >= clockIntervalMs
      ) {
        this.sendClock(room, now);
      }
    }
  }

  /**
   * Drops a client that has gone away, whether it was waiting or playing. Its
   * opponent wins, since a game in progress cannot be rejoined.
   */
  disconnect(client: Client): void {
    if (this.waiting.delete(client.id)) return;

    const room = this.roomByClient.get(client.id);
    if (!room) return;

    const color = this.colorOf(room, client.id);
    const opponent = invertColor(color);
    room.clients[opponent].send({ type: "opponentLeft", winner: opponent });
    this.closeRoom(room);
  }

  /**
   * The longest-waiting player whose preference fits `preference`, ignoring
   * `clientId` itself.
   *
   * Waiting players are paired in the order they arrived, so nobody is left in
   * the queue while later arrivals are served.
   */
  private findOpponent(
    preference: Preference,
    clientId: string,
  ): WaitingPlayer | undefined {
    for (const candidate of this.waiting.values()) {
      if (candidate.client.id === clientId) continue;
      if (canMatch(candidate, preference)) return candidate;
    }
    return undefined;
  }

  private startGame(first: WaitingPlayer, second: WaitingPlayer): void {
    const complexity = chooseComplexity(
      first.complexity,
      second.complexity,
      this.random,
    );
    const timeControl = describeTimeControl(
      chooseTimeControl(first.timeControl, second.timeControl, this.random),
    );

    // Which of the two players gets white is decided by the server, so neither
    // player can pick a side.
    const [white, black] = this.random() < 0.5
      ? [first, second]
      : [second, first];

    const room: Room = {
      id: `game-${this.nextGameNumber++}`,
      session: new GameSession(complexity),
      clock: new GameClock(timeControl),
      clients: { white: white.client, black: black.client },
      names: { white: white.name, black: black.name },
      drawOffers: new Set(),
      lastClockAt: this.now(),
    };
    this.rooms.set(room.id, room);
    this.roomByClient.set(white.client.id, room);
    this.roomByClient.set(black.client.id, room);

    white.client.send(this.matchedMessage(room, "white"));
    black.client.send(this.matchedMessage(room, "black"));
  }

  private matchedMessage(room: Room, color: Color): ServerMessage {
    const complexity = room.session.complexity;
    return {
      type: "matched",
      gameId: room.id,
      color,
      opponentName: room.names[invertColor(color)],
      complexity,
      complexityLabel: chaosLevels[complexity].label,
      timeControl: room.clock.timeControl,
      board: room.session.serializeBoard(),
    };
  }

  private colorOf(room: Room, clientId: string): Color {
    return room.clients.white.id === clientId ? "white" : "black";
  }

  private broadcast(room: Room, message: ServerMessage): void {
    room.clients.white.send(message);
    room.clients.black.send(message);
  }

  /** Sends both players what their clocks have left, and whose is running. */
  private sendClock(room: Room, now: number): void {
    room.lastClockAt = now;
    this.broadcast(room, { type: "clock", ...room.clock.snapshot(now) });
  }

  private endGame(room: Room, result: GameResult): void {
    this.broadcast(room, { type: "gameOver", ...result });
    this.closeRoom(room);
  }

  private closeRoom(room: Room): void {
    this.rooms.delete(room.id);
    this.roomByClient.delete(room.clients.white.id);
    this.roomByClient.delete(room.clients.black.id);
  }

  private fail(client: Client, message: string): void {
    client.send({ type: "error", message });
  }
}

/** The time control at `index`, spelled out the way a client is told it. */
export function describeTimeControl(index: number): TimeControlSpec {
  const clamped = clampTimeControl(index);
  const control = timeControls[clamped];
  return {
    index: clamped,
    label: timeControlLabel(control),
    ...timeControlMs(control),
  };
}

/** Strips control characters and caps the length of a player-supplied name. */
export function sanitizeName(value: unknown): string {
  if (typeof value !== "string") return "Anonymous";
  // Control characters are stripped rather than escaped, so a name cannot
  // smuggle line breaks or terminal escapes into the other player's screen.
  // deno-lint-ignore no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned === "") return "Anonymous";
  return cleaned.slice(0, maxNameLength);
}
