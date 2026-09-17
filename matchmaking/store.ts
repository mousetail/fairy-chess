import type { SerializedBoardState } from "../src/online/serialization.ts";
import type { Color, GameResult } from "../src/online/protocol.ts";
import type { ClockRecord } from "./clock.ts";
import type { LoggedMove } from "./pgn.ts";

/**
 * Where games and players are kept between connections and between runs of the
 * server.
 *
 * The lobby only ever talks to these interfaces, so a test can keep everything
 * in memory and a deployment can put the running games in Redis and the players
 * and finished games in PostgreSQL without the lobby telling them apart.
 */

/** One player's seat at a game: the identifier kept private, and the public name. */
export interface StoredSeat {
  /** The player's own identifier, which is never sent to the other player. */
  id: string;
  /** The name shown to the opponent. */
  name: string;
}

/** A move as it is logged, so a game's history survives a restart. */
export type StoredMove = LoggedMove;

/**
 * A game that is still running, as it is held between server runs. Everything
 * needed to carry it on is here: the position, the clocks, who holds which
 * seat, and the moves played so far.
 */
export interface StoredGame {
  id: string;
  complexity: number;
  /** The index into `timeControls` the game is played at. */
  timeControl: number;
  board: SerializedBoardState;
  /**
   * The position the game was laid out in, as FEN. A chaos layout is random, so
   * this is the only way back to the position the move list starts from.
   */
  initialFen: string;
  clock: ClockRecord;
  seats: Record<Color, StoredSeat>;
  drawOffers: Color[];
  moves: StoredMove[];
  /** When the game started, in wall-clock milliseconds. */
  createdAt: number;
  /** The result once the game has ended, and `null` while it runs. */
  result: GameResult | null;
}

/**
 * A finished game, for the record the database keeps of it.
 *
 * Its moves are kept as the move list and the PGN, which together with the
 * position it started from are everything needed to replay it. Neither the FEN
 * nor the PGN can name every piece with its own letter, so the alias map they
 * were written with is kept beside them.
 */
export interface FinishedGame {
  id: string;
  complexity: number;
  timeControl: number;
  seats: Record<Color, StoredSeat>;
  result: GameResult;
  /** The moves played, as a PGN move list. */
  pgn: string;
  /** The position the game started from, as FEN. */
  initialFen: string;
  /** The piece type key for each symbol used in the FEN and the PGN. */
  symbols: Record<string, string>;
  startedAt: number;
  finishedAt: number;
}

/** Where the games still being played are kept. */
export interface GameStore {
  save(game: StoredGame): Promise<void>;
  remove(id: string): Promise<void>;
  loadAll(): Promise<StoredGame[]>;
}

/** Where players and the games they have finished are kept. */
export interface PlayerStore {
  /** Records that a player is known by `name`, creating the row if it is new. */
  remember(id: string, name: string): Promise<void>;
  /** Stores a finished game and applies the rating change it earns. */
  recordGame(game: FinishedGame): Promise<void>;
}

/** A game store that keeps everything in memory, for tests and for a run with none configured. */
export class MemoryGameStore implements GameStore {
  private readonly games = new Map<string, string>();

  save(game: StoredGame): Promise<void> {
    this.games.set(game.id, JSON.stringify(game));
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.games.delete(id);
    return Promise.resolve();
  }

  loadAll(): Promise<StoredGame[]> {
    return Promise.resolve(
      [...this.games.values()].map((raw) => JSON.parse(raw) as StoredGame),
    );
  }
}

/** A player store that keeps everything in memory, for tests and for a run with none configured. */
export class MemoryPlayerStore implements PlayerStore {
  readonly remembered: { id: string; name: string }[] = [];
  readonly games: FinishedGame[] = [];

  remember(id: string, name: string): Promise<void> {
    this.remembered.push({ id, name });
    return Promise.resolve();
  }

  recordGame(game: FinishedGame): Promise<void> {
    this.games.push(game);
    return Promise.resolve();
  }
}
