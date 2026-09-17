import assert from "node:assert/strict";
import { Client } from "@db/postgres";
import { boardStateToFen } from "../../src/ai/fen.ts";
import { ChessGame } from "../../src/chess-game.ts";
import { serializeBoardState } from "../../src/online/serialization.ts";
import { chaosLevels } from "../../src/replacement-rules.ts";
import { PostgresPlayerStore } from "../postgres-store.ts";
import { RedisGameStore } from "../redis-store.ts";
import type { FinishedGame, StoredGame, StoredMove } from "../store.ts";

/**
 * The stores are exercised against the servers they are meant for, when a
 * deployment names them.
 *
 * The tests are skipped unless `REDIS_URL` and `DATABASE_URL` are set, so the
 * ordinary test run needs neither server; a local pair of containers, or a
 * development deployment, is enough to run them.
 */

/** The environment value named, or `undefined` where there is no access to it. */
function environment(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    // No permission to read the environment, so there is nothing to connect to.
    return undefined;
  }
}

const redisUrl = environment("REDIS_URL");
const databaseUrl = environment("DATABASE_URL");

/** A laid-out starting position at `complexity`, with its alias map. */
function layout(complexity: number) {
  return ChessGame.defaultLayout(chaosLevels[complexity]).state;
}

/** A short game: 1. e4, which is enough to give the record a move. */
function moves(): StoredMove[] {
  return [{ color: "white", pgn: "e4" }];
}

function storedGame(id: string): StoredGame {
  const complexity = 1;
  const state = layout(complexity);
  return {
    id,
    complexity,
    timeControl: 1,
    board: serializeBoardState(state),
    initialFen: boardStateToFen(state, 1),
    clock: {
      remaining: { white: 175_000, black: 180_000 },
      moved: { white: true, black: false },
      running: "black",
      startedAt: 1_700_000_000_000,
    },
    seats: {
      white: { id: "player-white", name: "Ada" },
      black: { id: "player-black", name: "Bob" },
    },
    drawOffers: ["black"],
    moves: moves(),
    createdAt: 1_700_000_000_000,
    result: null,
  };
}

Deno.test({
  name: "a running game survives a round trip through Redis",
  ignore: redisUrl === undefined,
  fn: async () => {
    const store = await RedisGameStore.open(redisUrl!);
    const game = storedGame(`fairy-chess-test-${crypto.randomUUID()}`);

    try {
      await store.save(game);

      // A second store stands in for a server that was restarted: it sees the
      // game another connection wrote.
      const reopened = await RedisGameStore.open(redisUrl!);
      const found = (await reopened.loadAll()).find(
        (candidate) => candidate.id === game.id,
      );
      assert.deepEqual(found, game, "the game should come back as it went in");

      await store.remove(game.id);
      assert.equal(
        (await store.loadAll()).find((candidate) => candidate.id === game.id),
        undefined,
        "a finished game should leave the store",
      );
    } finally {
      await store.remove(game.id);
    }
  },
});

Deno.test({
  name: "a finished game is recorded and moves both ratings",
  ignore: databaseUrl === undefined,
  fn: async () => {
    const store = await PostgresPlayerStore.open(databaseUrl!);
    const client = new Client(databaseUrl!);
    await client.connect();

    const stamp = crypto.randomUUID();
    const white = `test-white-${stamp}`;
    const black = `test-black-${stamp}`;
    const state = layout(0);
    const initialFen = boardStateToFen(state, 1);
    const symbols = serializeBoardState(state).symbols;
    const game: FinishedGame = {
      id: crypto.randomUUID(),
      complexity: 0,
      timeControl: 0,
      seats: {
        white: { id: white, name: "Ada" },
        black: { id: black, name: "Bob" },
      },
      result: { status: "resign", winner: "white" },
      pgn: "1. e4",
      initialFen,
      symbols,
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_060_000,
    };

    try {
      await store.recordGame(game);

      const rows = await client.queryObject<{
        status: string;
        winner: string | null;
        pgn: string;
        initial_fen: string;
        symbols: Record<string, string>;
        complexity: number;
        time_control: number;
      }>`SELECT status, winner, pgn, initial_fen, symbols, complexity, time_control
          FROM games WHERE id = ${game.id}`;
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0].status, "resign");
      assert.equal(rows.rows[0].winner, "white");
      assert.equal(rows.rows[0].pgn, "1. e4");
      assert.equal(rows.rows[0].initial_fen, initialFen);
      // The alias map comes back whole, so the FEN and PGN can be read.
      assert.deepEqual(rows.rows[0].symbols, symbols);
      assert.equal(rows.rows[0].complexity, 0);
      assert.equal(rows.rows[0].time_control, 0);

      // A win against an equal is worth half the k-factor, both ways.
      const after = await ratings(client, white, black);
      assert.deepEqual(after, { white: 1216, black: 1184, games: 1 });

      // Recording the same game again must not move the ratings a second time.
      await store.recordGame(game);
      assert.deepEqual(await ratings(client, white, black), after);

      // The game can be looked up by its id, with both players named from the
      // rows their identifiers point at rather than from the game itself.
      const stored = await store.finishedGame(game.id);
      assert.ok(stored, "the finished game should be there");
      assert.equal(stored.seats.white.name, "Ada");
      assert.equal(stored.seats.black.name, "Bob");
      assert.equal(stored.pgn, "1. e4");
      assert.equal(stored.initialFen, initialFen);
      assert.deepEqual(stored.symbols, symbols);
      assert.deepEqual(stored.result, game.result);
      assert.equal(stored.timeControl, 0);

      // An id that holds no game, or is not even a UUID, is simply no game.
      assert.equal(await store.finishedGame("no-such-game"), null);
    } finally {
      await client.queryArray`DELETE FROM games WHERE id = ${game.id}`;
      await client
        .queryArray`DELETE FROM players WHERE id IN (${white}, ${black})`;
      await client.end();
    }
  },
});

Deno.test({
  name: "a player is remembered under the name they last played as",
  ignore: databaseUrl === undefined,
  fn: async () => {
    const store = await PostgresPlayerStore.open(databaseUrl!);
    const client = new Client(databaseUrl!);
    await client.connect();

    const id = `test-player-${crypto.randomUUID()}`;
    try {
      await store.remember(id, "Ada");
      assert.equal(await nameOf(client, id), "Ada");

      // Joining again under a new name updates the row rather than adding one.
      await store.remember(id, "Ada Lovelace");
      assert.equal(await nameOf(client, id), "Ada Lovelace");
      const count = await client.queryObject<{ count: number }>`
        SELECT count(*)::int AS count FROM players WHERE id = ${id}
      `;
      assert.equal(count.rows[0].count, 1);
    } finally {
      await client.queryArray`DELETE FROM players WHERE id = ${id}`;
      await client.end();
    }
  },
});

async function ratings(
  client: Client,
  white: string,
  black: string,
): Promise<{ white: number; black: number; games: number }> {
  const { rows } = await client.queryObject<{
    id: string;
    rating: number;
    games: number;
  }>`SELECT id, rating, games FROM players WHERE id IN (${white}, ${black})`;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    white: byId.get(white)!.rating,
    black: byId.get(black)!.rating,
    games: byId.get(white)!.games,
  };
}

async function nameOf(client: Client, id: string): Promise<string | null> {
  const { rows } = await client.queryObject<{ name: string }>`
    SELECT name FROM players WHERE id = ${id}
  `;
  return rows[0]?.name ?? null;
}
