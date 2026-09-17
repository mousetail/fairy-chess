import { Client } from "@db/postgres";
import type { Color, GameOverStatus } from "../src/online/protocol.ts";
import type { FinishedGame, PlayerStore } from "./store.ts";
import { resultScores, startingRating, updatedRatings } from "./rating.ts";

/**
 * Players and finished games, kept in PostgreSQL.
 *
 * A player is a row named by the identifier their browser keeps; their name and
 * rating are stored beside it. A finished game is a row of its own, holding the
 * moves as a PGN and the position they were played from, so a game's history
 * outlives the process that played it. Neither is sent to a client: the ratings
 * are followed quietly and the game log is not shown anywhere yet.
 */

/** The table holding one row per player. */
const playersTable = `
CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  rating integer NOT NULL DEFAULT ${startingRating},
  games integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

/** The table holding one row per finished game. */
const gamesTable = `
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY,
  complexity integer NOT NULL,
  time_control integer NOT NULL,
  white_id text NOT NULL,
  black_id text NOT NULL,
  status text NOT NULL,
  winner text,
  pgn text NOT NULL,
  initial_fen text NOT NULL,
  symbols jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
)`;

export class PostgresPlayerStore implements PlayerStore {
  private readonly client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  /**
   * Connects to the database named by `url`, e.g.
   * `postgres://user:password@localhost:5432/fairy_chess`, and makes sure its
   * tables exist.
   */
  static async open(url: string): Promise<PostgresPlayerStore> {
    const client = new Client(url);
    await client.connect();
    const store = new PostgresPlayerStore(client);
    await store.migrate();
    return store;
  }

  /** Creates the tables when they are not there yet. */
  async migrate(): Promise<void> {
    await this.client.queryArray(playersTable);
    await this.client.queryArray(gamesTable);
  }

  async remember(id: string, name: string): Promise<void> {
    await this.upsertPlayer(id, name);
  }

  /**
   * Stores a finished game and moves both players' ratings by it.
   *
   * The game row is written once: a retry after a crash finds it already there
   * and leaves the ratings alone, so a game is never counted twice.
   */
  async recordGame(game: FinishedGame): Promise<void> {
    // The player rows are written first, so a game always refers to players
    // that exist however it was that a join went unrecorded. The names live
    // there rather than beside the game, which only needs the identifiers.
    await this.upsertPlayer(game.seats.white.id, game.seats.white.name);
    await this.upsertPlayer(game.seats.black.id, game.seats.black.name);

    const inserted = await this.client.queryObject<{ id: string }>`
      INSERT INTO games (
        id, complexity, time_control,
        white_id, black_id,
        status, winner, pgn, initial_fen, symbols, started_at
      ) VALUES (
        ${game.id}, ${game.complexity}, ${game.timeControl},
        ${game.seats.white.id}, ${game.seats.black.id},
        ${game.result.status}, ${game.result.winner},
        ${game.pgn}, ${game.initialFen}, ${JSON.stringify(game.symbols)}::jsonb,
        ${new Date(game.startedAt).toISOString()}::timestamptz
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (inserted.rows.length === 0) return;

    const scores = resultScores(game.result);
    if (scores === null) return;

    const white = await this.rating(game.seats.white.id);
    const black = await this.rating(game.seats.black.id);
    const next = updatedRatings(white, black, scores);
    await this.setRating(game.seats.white.id, next.white);
    await this.setRating(game.seats.black.id, next.black);
  }

  /**
   * The finished game with this id, with both players named from their rows.
   *
   * The identifier is compared as text, so an id that is not a UUID is simply a
   * game that is not there rather than an error from the database.
   */
  async finishedGame(id: string): Promise<FinishedGame | null> {
    const { rows } = await this.client.queryObject<{
      complexity: number;
      time_control: number;
      white_id: string;
      black_id: string;
      white_name: string | null;
      black_name: string | null;
      status: string;
      winner: string | null;
      pgn: string;
      initial_fen: string;
      symbols: Record<string, string>;
      started_at: Date;
      finished_at: Date;
    }>`
      SELECT
        g.complexity, g.time_control, g.white_id, g.black_id,
        g.status, g.winner, g.pgn, g.initial_fen, g.symbols,
        g.started_at, g.finished_at,
        wp.name AS white_name, bp.name AS black_name
      FROM games g
      LEFT JOIN players wp ON wp.id = g.white_id
      LEFT JOIN players bp ON bp.id = g.black_id
      WHERE g.id::text = ${id}
    `;

    const row = rows[0];
    if (!row) return null;
    return {
      id,
      complexity: row.complexity,
      timeControl: row.time_control,
      seats: {
        white: { id: row.white_id, name: row.white_name ?? "" },
        black: { id: row.black_id, name: row.black_name ?? "" },
      },
      result: {
        status: row.status as GameOverStatus,
        winner: (row.winner as Color | "draw" | null) ?? null,
      },
      pgn: row.pgn,
      initialFen: row.initial_fen,
      symbols: row.symbols,
      startedAt: row.started_at.getTime(),
      finishedAt: row.finished_at.getTime(),
    };
  }

  private async upsertPlayer(id: string, name: string): Promise<void> {
    await this.client.queryArray`
      INSERT INTO players (id, name) VALUES (${id}, ${name})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    `;
  }

  private async rating(id: string): Promise<number> {
    const { rows } = await this.client.queryObject<{ rating: number }>`
      SELECT rating FROM players WHERE id = ${id}
    `;
    return rows[0]?.rating ?? startingRating;
  }

  private async setRating(id: string, rating: number): Promise<void> {
    await this.client.queryArray`
      UPDATE players SET rating = ${rating}, games = games + 1, updated_at = now()
      WHERE id = ${id}
    `;
  }
}
