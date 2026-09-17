import { connect, parseURL, type Redis } from "@db/redis";
import type { GameStore, StoredGame } from "./store.ts";

/**
 * The games still being played, kept in Redis.
 *
 * A game is a single JSON value under a key named after its UUID, which is what
 * lets a player come back to it by the number in their address bar and lets a
 * restarted server pick it up again. Nothing else about the game lives here: the
 * players and the finished games belong in PostgreSQL.
 */

/** The prefix every game key carries, so the store can find its own keys. */
const keyPrefix = "fairy-chess:game:";

function keyOf(id: string): string {
  return keyPrefix + id;
}

export class RedisGameStore implements GameStore {
  private readonly redis: Redis;

  private constructor(redis: Redis) {
    this.redis = redis;
  }

  /** Opens a store over the Redis server named by `url`, e.g. `redis://localhost:6379`. */
  static async open(url: string): Promise<RedisGameStore> {
    return new RedisGameStore(await connect(parseURL(url)));
  }

  async save(game: StoredGame): Promise<void> {
    await this.redis.set(keyOf(game.id), JSON.stringify(game));
  }

  async remove(id: string): Promise<void> {
    await this.redis.del(keyOf(id));
  }

  async loadAll(): Promise<StoredGame[]> {
    const keys = await this.redis.keys(`${keyPrefix}*`);
    const games: StoredGame[] = [];
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw === null) continue;
      try {
        games.push(JSON.parse(raw) as StoredGame);
      } catch (error) {
        // A value that cannot be read is of no use to anyone, and leaving it
        // would only make the next restart fail the same way.
        console.error(`Dropping an unreadable stored game at ${key}:`, error);
        await this.redis.del(key);
      }
    }
    return games;
  }
}
