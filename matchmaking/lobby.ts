import { invertColor } from "../src/chess-board.ts";
import { serializeMove } from "../src/online/serialization.ts";
import {
  type ClientMessage,
  type Color,
  type GameHistory,
  type GameResult,
  isPlayerId,
  type ServerMessage,
  type TimeControlSpec,
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
import { movesToPgn, parsePgn } from "./pgn.ts";
import { replayGame } from "./replay.ts";
import {
  canMatch,
  chooseComplexity,
  chooseTimeControl,
  clampComplexity,
  type Preference,
} from "./matchmaking.ts";
import {
  type FinishedGame,
  type GameStore,
  MemoryGameStore,
  MemoryPlayerStore,
  type PlayerStore,
  type StoredGame,
  type StoredMove,
  type StoredSeat,
} from "./store.ts";

/** What the lobby needs from a connected player. */
export interface Client {
  readonly id: string;
  send(message: ServerMessage): void;
  /** Drops the connection, when the seat it held is taken over. Optional in tests. */
  close?(code: number, reason: string): void;
}

/** A player waiting for an opponent. */
interface WaitingPlayer extends Preference {
  client: Client;
  seat: StoredSeat;
}

/**
 * A game in progress, together with the players sitting at it.
 *
 * A seat is `null` while its player is away. The game is not over when that
 * happens: the clock is what ends it if they do not come back, and the player
 * can take the seat back until their time runs out.
 */
interface Room {
  id: string;
  session: GameSession;
  clock: GameClock;
  clients: Record<Color, Client | null>;
  seats: Record<Color, StoredSeat>;
  /** The position the game was laid out in, as FEN. */
  initialFen: string;
  /**
   * The sides that have offered a draw. An offer stands until a move is played,
   * which clears both sides' offers, or until the side that made it takes it
   * back.
   */
  drawOffers: Set<Color>;
  /** When the players were last sent their clocks, so they are not spammed. */
  lastClockAt: number;
  /** Every move played so far, so the game's log survives a restart. */
  moves: StoredMove[];
  /** When the game started, in wall-clock milliseconds. */
  createdAt: number;
}

export interface LobbyOptions {
  /** Overridable for tests, which want a deterministic colour assignment. */
  random?: () => number;
  /** The current time, overridable so a test can drive the clocks itself. */
  now?: () => number;
  /** Where the running games are kept. In memory unless a deployment says otherwise. */
  games?: GameStore;
  /** Where players and finished games are kept. In memory unless a deployment says otherwise. */
  players?: PlayerStore;
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
 * A game outlives both the connection that started it and the process that is
 * running it: it is kept in the game store under a UUID, so a player who reloads
 * or a server that restarts can pick it up again. Waiting players are still held
 * in memory, so the server must run as a single instance.
 */
export class Lobby {
  private readonly waiting = new Map<string, WaitingPlayer>();
  private readonly rooms = new Map<string, Room>();
  private readonly roomByClient = new Map<string, Room>();
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly games: GameStore;
  private readonly players: PlayerStore;
  /**
   * The writes waiting to reach the game store, per game. A change is written
   * when it happens and the answer is not waited for, so the writes are chained
   * to keep them in order: a save still in flight when the game ends must not
   * land after the game has been removed.
   */
  private readonly writes = new Map<string, Promise<void>>();

  constructor(options: LobbyOptions = {}) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.games = options.games ?? new MemoryGameStore();
    this.players = options.players ?? new MemoryPlayerStore();
  }

  /** How many players are waiting for an opponent. */
  get waitingCount(): number {
    return this.waiting.size;
  }

  /** How many games are being played. */
  get gameCount(): number {
    return this.rooms.size;
  }

  /**
   * Takes back the games that were running when the server last stopped.
   *
   * A restored game has nobody sitting at it, so both seats are treated as gone:
   * their free first moves are over and the clocks run, so a game nobody comes
   * back to ends on time rather than waiting for a move that will never come. A
   * game whose clock ran out while the server was down is finished here.
   */
  async restore(): Promise<void> {
    const records = await this.games.loadAll();
    const now = this.now();
    for (const record of records) {
      if (this.rooms.has(record.id)) continue;
      const room = this.roomFromRecord(record);
      for (const color of ["white", "black"] as Color[]) {
        room.clock.absent(color, room.session.colorToMove, now);
      }
      this.rooms.set(record.id, room);
    }
    this.tick(now);
  }

  handleMessage(client: Client, message: ClientMessage): void {
    switch (message.type) {
      case "join":
        this.join(client, message);
        return;
      case "rejoin":
        this.rejoin(client, message);
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
    options: {
      complexity: number;
      timeControl: number;
      name?: string;
      playerId?: string;
    },
  ): void {
    if (this.roomByClient.has(client.id)) {
      this.fail(client, "You are already playing a game.");
      return;
    }

    const complexity = clampComplexity(options.complexity);
    const timeControl = clampTimeControl(options.timeControl);
    const seat: StoredSeat = {
      id: resolvePlayerId(options.playerId),
      name: sanitizeName(options.name),
    };
    this.rememberPlayer(seat);

    const waiting: WaitingPlayer = {
      client,
      complexity,
      timeControl,
      seat,
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

  /**
   * Puts `client` back at a game that is still running, if the identifier it
   * gives holds a seat there. A connection already in the seat is taken over,
   * since the identifier is the player's own and the older connection may be one
   * the server has not noticed going away.
   */
  rejoin(
    client: Client,
    message: Extract<ClientMessage, { type: "rejoin" }>,
  ): void {
    if (this.roomByClient.has(client.id)) {
      this.fail(client, "You are already playing a game.");
      return;
    }

    const room = this.rooms.get(message.gameId);
    if (!room) {
      // Not running: it may have finished, in which case anyone holding its id
      // may look at it again.
      this.review(client, message.gameId, message.playerId);
      return;
    }

    const color = this.colorOfPlayer(room.seats, message.playerId);
    // The same answer either way, so a stranger cannot learn which identifiers
    // hold a seat at a game they only know the number of.
    if (color === null) {
      this.fail(client, "You are not a player in that game.");
      return;
    }

    // A seat may look taken over by a connection that has in fact gone: a
    // half-open socket the server has not noticed closing. The identifier is
    // the player's own, so the new connection takes the seat and the old one is
    // dropped rather than both being refused.
    const previous = room.clients[color];
    if (previous) {
      this.roomByClient.delete(previous.id);
      previous.send({
        type: "error",
        message: "This seat was taken over by another connection.",
      });
      previous.close?.(1000, "seat taken over");
    }

    room.clients[color] = client;
    this.roomByClient.set(client.id, room);
    client.send(this.resumedMessage(room, color));
    room.clients[invertColor(color)]?.send({
      type: "opponentBack",
      color,
    });
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
    room.moves.push({ color, pgn: outcome.applied.pgn });

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
    this.persist(room);
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

    if (!room.drawOffers.has(invertColor(color))) {
      this.persist(room);
      return;
    }
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
    this.persist(room);
  }

  /**
   * Checks every game's clock.
   *
   * A game whose side to move has run out of time is lost, which is also what
   * ends a game whose player went away without coming back. The players of every
   * other game are sent their clocks again so a client that fell behind catches
   * up. The caller runs this on a timer; a test calls it directly.
   */
  tick(now: number = this.now()): void {
    for (const room of [...this.rooms.values()]) {
      if (!this.rooms.has(room.id)) continue;

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
   * Drops a client that has gone away, whether it was waiting or playing.
   *
   * A game in progress is not lost when its player disconnects: the seat is
   * left empty for them to come back to. The clock is what ends it if they do
   * not — it runs for the side to move, including one who never made their free
   * first move, so the opponent wins on time rather than waiting forever.
   */
  disconnect(client: Client): void {
    if (this.waiting.delete(client.id)) return;

    const room = this.roomByClient.get(client.id);
    if (!room) return;

    this.roomByClient.delete(client.id);
    const color = this.colorOf(room, client.id);
    room.clients[color] = null;
    room.clock.absent(color, room.session.colorToMove, this.now());
    room.clients[invertColor(color)]?.send({ type: "opponentAway", color });
    this.persist(room);
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

    const now = this.now();
    const session = new GameSession(complexity);
    const room: Room = {
      // The UUID is the game's public name: it is what the players put in the
      // address bar to come back to the game, and what the store is keyed by.
      id: crypto.randomUUID(),
      session,
      clock: new GameClock(timeControl),
      clients: { white: white.client, black: black.client },
      seats: { white: white.seat, black: black.seat },
      // The layout is fixed here, so this is the last moment the starting
      // position can be written down.
      initialFen: session.fen(),
      drawOffers: new Set(),
      lastClockAt: now,
      moves: [],
      createdAt: now,
    };
    this.rooms.set(room.id, room);
    this.roomByClient.set(white.client.id, room);
    this.roomByClient.set(black.client.id, room);

    white.client.send(this.matchedMessage(room, "white"));
    black.client.send(this.matchedMessage(room, "black"));
    this.persist(room);
  }

  private matchedMessage(room: Room, color: Color): ServerMessage {
    const complexity = room.session.complexity;
    return {
      type: "matched",
      gameId: room.id,
      playerId: room.seats[color].id,
      color,
      opponentName: room.seats[invertColor(color)].name,
      complexity,
      complexityLabel: chaosLevels[complexity].label,
      timeControl: room.clock.timeControl,
      board: room.session.serializeBoard(),
    };
  }

  private resumedMessage(room: Room, color: Color): ServerMessage {
    const complexity = room.session.complexity;
    return {
      type: "resumed",
      gameId: room.id,
      playerId: room.seats[color].id,
      color,
      playerName: room.seats[color].name,
      opponentName: room.seats[invertColor(color)].name,
      complexity,
      complexityLabel: chaosLevels[complexity].label,
      timeControl: room.clock.timeControl,
      board: room.session.serializeBoard(),
      clock: room.clock.snapshot(this.now()),
      drawOffers: [...room.drawOffers],
      history: this.historyOf(room),
    };
  }

  /**
   * A running game from its opening, so a reconnecting client can put its move
   * log back. A record that cannot be replayed leaves the history empty rather
   * than keeping the player out of their game.
   */
  private historyOf(room: Room): GameHistory {
    try {
      return replayGame(room.initialFen, room.session.symbols(), room.moves);
    } catch (error) {
      console.error(`Could not rebuild the history of game ${room.id}:`, error);
      return { initialBoard: room.session.serializeBoard(), moves: [] };
    }
  }

  /**
   * Sends a finished game to someone who asked for it by its id.
   *
   * The game is not in the store the running ones live in, so it comes from the
   * recorded ones: its moves are replayed from the PGN it was stored as, and its
   * players are named from the rows their identifiers point at.
   */
  private review(client: Client, gameId: string, playerId: string): void {
    this.players.finishedGame(gameId).then((game) => {
      if (!game) {
        this.fail(client, "That game is no longer available.");
        return;
      }

      let history: GameHistory;
      try {
        history = replayGame(game.initialFen, game.symbols, parsePgn(game.pgn));
      } catch (error) {
        console.error(`Could not replay the finished game ${game.id}:`, error);
        this.fail(client, "That game could not be put back together.");
        return;
      }

      const color = this.colorOfPlayer(game.seats, playerId);
      const label = chaosLevels[game.complexity]?.label ?? chaosLevels[0].label;
      client.send({
        type: "reviewed",
        gameId: game.id,
        color,
        whiteName: game.seats.white.name,
        blackName: game.seats.black.name,
        complexity: game.complexity,
        complexityLabel: label,
        timeControl: describeTimeControl(game.timeControl),
        result: game.result,
        initialBoard: history.initialBoard,
        moves: history.moves,
      });
    }).catch((error) => {
      console.error(`Could not look up the finished game ${gameId}:`, error);
      this.fail(client, "That game could not be loaded.");
    });
  }

  private colorOf(room: Room, clientId: string): Color {
    return room.clients.white?.id === clientId ? "white" : "black";
  }

  private colorOfPlayer(
    seats: Record<Color, StoredSeat>,
    playerId: string,
  ): Color | null {
    if (seats.white.id === playerId) return "white";
    if (seats.black.id === playerId) return "black";
    return null;
  }

  private broadcast(room: Room, message: ServerMessage): void {
    room.clients.white?.send(message);
    room.clients.black?.send(message);
  }

  /** Sends both players what their clocks have left, and whose is running. */
  private sendClock(room: Room, now: number): void {
    room.lastClockAt = now;
    this.broadcast(room, { type: "clock", ...room.clock.snapshot(now) });
  }

  private endGame(room: Room, result: GameResult): void {
    if (!this.rooms.delete(room.id)) return;
    for (const color of ["white", "black"] as Color[]) {
      const client = room.clients[color];
      if (client) this.roomByClient.delete(client.id);
    }
    this.broadcast(room, { type: "gameOver", ...result });
    this.persistFinished(room, result);
  }

  /** Rebuilds a room from the record the store kept of it. */
  private roomFromRecord(record: StoredGame): Room {
    return {
      id: record.id,
      session: new GameSession(record.complexity, {
        board: record.board,
        result: record.result,
      }),
      clock: new GameClock(
        describeTimeControl(record.timeControl),
        record.clock,
      ),
      clients: { white: null, black: null },
      seats: record.seats,
      initialFen: record.initialFen,
      drawOffers: new Set(record.drawOffers),
      lastClockAt: this.now(),
      moves: record.moves,
      createdAt: record.createdAt,
    };
  }

  /** The record of a running game, as the store keeps it. */
  private recordOf(room: Room): StoredGame {
    return {
      id: room.id,
      complexity: room.session.complexity,
      timeControl: room.clock.timeControl.index,
      board: room.session.serializeBoard(),
      initialFen: room.initialFen,
      clock: room.clock.state(),
      seats: room.seats,
      drawOffers: [...room.drawOffers],
      moves: room.moves,
      createdAt: room.createdAt,
      result: room.session.finished,
    };
  }

  private persist(room: Room): void {
    this.enqueue(room.id, () => this.games.save(this.recordOf(room)));
  }

  private persistFinished(room: Room, result: GameResult): void {
    this.enqueue(room.id, () => this.games.remove(room.id));

    const finished: FinishedGame = {
      id: room.id,
      complexity: room.session.complexity,
      timeControl: room.clock.timeControl.index,
      seats: room.seats,
      result,
      pgn: movesToPgn(room.moves),
      initialFen: room.initialFen,
      symbols: room.session.symbols(),
      startedAt: room.createdAt,
      finishedAt: this.now(),
    };
    this.players.recordGame(finished).catch((error) => {
      console.error(`Could not record the finished game ${room.id}:`, error);
    });
  }

  /**
   * Adds a write for `id` to that game's queue, so writes land in the order they
   * happened. A failed write is reported and the next one still runs.
   */
  private enqueue(id: string, work: () => Promise<void>): void {
    const previous = this.writes.get(id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(work)
      .catch((error) => {
        console.error(`Could not store game ${id}:`, error);
      });
    this.writes.set(id, next);
    void next.finally(() => {
      if (this.writes.get(id) === next) this.writes.delete(id);
    });
  }

  private rememberPlayer(seat: StoredSeat): void {
    this.players.remember(seat.id, seat.name).catch((error) => {
      console.error(`Could not store player ${seat.id}:`, error);
    });
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

/** The identifier a client sent, or a fresh one when it sent none or a bad one. */
function resolvePlayerId(value: unknown): string {
  return isPlayerId(value) ? value : crypto.randomUUID();
}
