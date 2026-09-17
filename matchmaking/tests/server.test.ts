import assert from "node:assert/strict";
import {
  type ClientMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "../../src/online/protocol.ts";
import { Lobby } from "../lobby.ts";
import { type RunningServer, startServer } from "../main.ts";
import { PostgresPlayerStore } from "../postgres-store.ts";
import { RedisGameStore } from "../redis-store.ts";

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

/** Waits, so a write the lobby made without waiting for it has landed. */
function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A websocket client that queues whatever arrives, for a test to await. */
class TestClient {
  readonly socket: WebSocket;
  readonly ready: Promise<void>;
  private readonly queued: ServerMessage[] = [];
  private readonly waiters: Array<(message: ServerMessage) => void> = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.onopen = () => resolve();
      this.socket.onerror = () =>
        reject(new Error(`could not connect to ${url}`));
    });
    this.socket.onmessage = (event) => {
      this.push(JSON.parse(event.data as string) as ServerMessage);
    };
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** The next message of `type`, throwing away the ones in between. */
  async next<T extends ServerMessage["type"]>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const message = await this.poll(5000);
      if (message.type === type) {
        return message as Extract<ServerMessage, { type: T }>;
      }
    }
  }

  close(): void {
    this.socket.close();
  }

  private push(message: ServerMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(message);
    else this.queued.push(message);
  }

  private poll(timeoutMs: number): Promise<ServerMessage> {
    const queued = this.queued.shift();
    if (queued) return Promise.resolve(queued);

    return new Promise<ServerMessage>((resolve, reject) => {
      const waiter = (message: ServerMessage) => {
        clearTimeout(timer);
        resolve(message);
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new Error("timed out waiting for a message"));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}

/** Starts a server on a port the operating system picks, and its base URL. */
function startLocalServer(): { running: RunningServer; origin: string } {
  const running = startServer({
    port: 0,
    hostname: "127.0.0.1",
    heartbeatMs: 0,
    // A fixed coin, so the colours and the settings a game is played at are the
    // same on every run.
    random: () => 0,
  });
  const address = running.server.addr;
  if (address.transport !== "tcp") throw new Error("expected a TCP listener");
  return { running, origin: `127.0.0.1:${address.port}` };
}

/**
 * Starts a server over the real stores, restoring the games in progress the way
 * a deployment does. Returns the game store too, so a test can tidy up after.
 */
async function startPersistentServer(): Promise<{
  running: RunningServer;
  origin: string;
  games: RedisGameStore;
}> {
  const games = await RedisGameStore.open(redisUrl!);
  const players = await PostgresPlayerStore.open(databaseUrl!);
  const lobby = new Lobby({ games, players, random: () => 0 });
  await lobby.restore();

  const running = startServer({
    port: 0,
    hostname: "127.0.0.1",
    heartbeatMs: 0,
    lobby,
  });
  const address = running.server.addr;
  if (address.transport !== "tcp") throw new Error("expected a TCP listener");
  return { running, origin: `127.0.0.1:${address.port}`, games };
}

Deno.test("two clients are matched and play a game over a websocket", async () => {
  const { running, origin } = startLocalServer();
  const clients: TestClient[] = [];

  try {
    const info = (await (await fetch(`http://${origin}/`)).json()) as {
      protocolVersion: number;
      games: number;
    };
    assert.equal(info.protocolVersion, PROTOCOL_VERSION);
    assert.equal(info.games, 0);
    // A plain request cannot be upgraded.
    assert.equal((await fetch(`http://${origin}/ws`)).status, 426);

    const first = new TestClient(`ws://${origin}/ws`);
    const second = new TestClient(`ws://${origin}/ws`);
    const spectator = new TestClient(`ws://${origin}/ws`);
    clients.push(first, second, spectator);
    await Promise.all([first.ready, second.ready, spectator.ready]);

    const welcome = await first.next("welcome");
    assert.equal(welcome.protocolVersion, PROTOCOL_VERSION);
    assert.equal(welcome.complexityLabels.length, welcome.maxComplexity + 1);
    assert.deepEqual(welcome.timeControlLabels, ["1+2", "3+2", "5+5", "10+10"]);

    // The two players ask for neighbouring levels, so they may be paired; the
    // coin came up low, so the game is played at the less chaotic of the two.
    first.send({ type: "join", complexity: 0, timeControl: 1, name: "Ada" });
    second.send({ type: "join", complexity: 1, timeControl: 1, name: "Bob" });

    const [firstMatch, secondMatch] = await Promise.all([
      first.next("matched"),
      second.next("matched"),
    ]);
    assert.equal(firstMatch.gameId, secondMatch.gameId);
    assert.notEqual(firstMatch.color, secondMatch.color);
    assert.equal(firstMatch.complexity, 0);
    assert.equal(firstMatch.complexityLabel, "normal chess");
    assert.equal(firstMatch.timeControl.label, "3+2");
    assert.equal(firstMatch.timeControl.initialMs, 180_000);
    assert.equal(firstMatch.opponentName, "Bob");
    assert.equal(secondMatch.opponentName, "Ada");
    assert.equal(firstMatch.board.pieces.length, 32);
    assert.equal(firstMatch.board.turn, "white");

    // A third player who asks for full chaos has nobody to play, so it waits.
    spectator.send({ type: "join", complexity: 4, timeControl: 1 });
    assert.equal((await spectator.next("queued")).waiting, 1);

    const white = firstMatch.color === "white" ? first : second;
    const black = firstMatch.color === "white" ? second : first;

    white.send({
      type: "move",
      pieceId: 4,
      from: { x: 4, y: 1 },
      to: { x: 4, y: 3 },
    });
    assert.equal((await white.next("moved")).pgn, "e4");
    const relayed = await black.next("moved");
    assert.equal(relayed.pgn, "e4");
    assert.equal(relayed.color, "white");
    assert.equal(relayed.board.turn, "black");

    // Moving twice in a row is refused, and only the mover hears about it.
    white.send({
      type: "move",
      pieceId: 4,
      from: { x: 4, y: 3 },
      to: { x: 4, y: 4 },
    });
    assert.equal(
      (await white.next("moveRejected")).rejection.reason,
      "not-your-turn",
    );

    black.send({ type: "resign" });
    assert.equal((await black.next("gameOver")).winner, "white");
    const over = await white.next("gameOver");
    assert.equal(over.status, "resign");
    assert.equal(over.winner, "white");
  } finally {
    for (const client of clients) client.close();
    await running.server.shutdown();
  }
});

Deno.test("a player can take their seat back by the game's UUID", async () => {
  const { running, origin } = startLocalServer();
  const clients: TestClient[] = [];

  try {
    const first = new TestClient(`ws://${origin}/ws`);
    const second = new TestClient(`ws://${origin}/ws`);
    clients.push(first, second);
    await Promise.all([first.ready, second.ready]);
    await Promise.all([first.next("welcome"), second.next("welcome")]);

    first.send({
      type: "join",
      complexity: 0,
      timeControl: 0,
      name: "Ada",
      playerId: "player-ada",
    });
    second.send({
      type: "join",
      complexity: 0,
      timeControl: 0,
      name: "Bob",
      playerId: "player-bob",
    });
    const [firstMatch, secondMatch] = await Promise.all([
      first.next("matched"),
      second.next("matched"),
    ]);
    // Each player is told their own identifier, which the browser keeps.
    assert.equal(firstMatch.playerId, "player-ada");
    assert.equal(secondMatch.playerId, "player-bob");

    const firstIsWhite = firstMatch.color === "white";
    const white = firstIsWhite ? first : second;
    const black = firstIsWhite ? second : first;
    const whiteMatch = firstIsWhite ? firstMatch : secondMatch;
    const blackMatch = firstIsWhite ? secondMatch : firstMatch;

    white.send({
      type: "move",
      pieceId: 4,
      from: { x: 4, y: 1 },
      to: { x: 4, y: 3 },
    });
    await white.next("moved");
    await black.next("moved");

    // White's socket drops. The opponent is told, but the game is not over.
    white.close();
    assert.equal((await black.next("opponentAway")).color, whiteMatch.color);

    // A fresh socket takes the seat back by the number the game is known by.
    const returning = new TestClient(`ws://${origin}/ws`);
    clients.push(returning);
    await returning.ready;
    await returning.next("welcome");
    returning.send({
      type: "rejoin",
      gameId: whiteMatch.gameId,
      playerId: whiteMatch.playerId,
    });
    const resumed = await returning.next("resumed");
    assert.equal(resumed.gameId, whiteMatch.gameId);
    assert.equal(resumed.color, whiteMatch.color);
    assert.equal(resumed.opponentName, "Bob");
    assert.equal(resumed.playerName, "Ada");
    assert.equal(resumed.board.turn, "black");
    assert.equal(resumed.clock.running, null);
    assert.ok(resumed.clock.white > 60_000, "white's increment survived");
    // The move log comes back with the seat, so the history is not lost.
    assert.equal(resumed.history.initialBoard.turn, "white");
    assert.deepEqual(resumed.history.moves.map((move) => move.pgn), ["e4"]);
    assert.equal((await black.next("opponentBack")).color, whiteMatch.color);

    // The game carries on between the two seats, one of them on a new socket.
    black.send({
      type: "move",
      pieceId: 12,
      from: { x: 4, y: 6 },
      to: { x: 4, y: 4 },
    });
    assert.equal((await returning.next("moved")).color, blackMatch.color);
  } finally {
    for (const client of clients) client.close();
    await running.server.shutdown();
  }
});

Deno.test("a finished game can be shared and read by its id", async () => {
  const { running, origin } = startLocalServer();
  const clients: TestClient[] = [];

  try {
    const first = new TestClient(`ws://${origin}/ws`);
    const second = new TestClient(`ws://${origin}/ws`);
    clients.push(first, second);
    await Promise.all([first.ready, second.ready]);
    await Promise.all([first.next("welcome"), second.next("welcome")]);

    first.send({
      type: "join",
      complexity: 0,
      timeControl: 0,
      name: "Ada",
      playerId: "ada",
    });
    second.send({
      type: "join",
      complexity: 0,
      timeControl: 0,
      name: "Bob",
      playerId: "bob",
    });
    const [firstMatch] = await Promise.all([
      first.next("matched"),
      second.next("matched"),
    ]);

    const firstIsWhite = firstMatch.color === "white";
    const white = firstIsWhite ? first : second;
    const black = firstIsWhite ? second : first;
    white.send({
      type: "move",
      pieceId: 4,
      from: { x: 4, y: 1 },
      to: { x: 4, y: 3 },
    });
    await white.next("moved");
    await black.next("moved");
    black.send({ type: "resign" });
    await Promise.all([white.next("gameOver"), black.next("gameOver")]);

    // The link that is shared names the game, and anyone holding it can read it.
    const visitor = new TestClient(`ws://${origin}/ws`);
    clients.push(visitor);
    await visitor.ready;
    await visitor.next("welcome");
    visitor.send({
      type: "rejoin",
      gameId: firstMatch.gameId,
      playerId: "someone-else",
    });

    const reviewed = await visitor.next("reviewed");
    assert.equal(reviewed.gameId, firstMatch.gameId);
    assert.equal(reviewed.color, null, "the visitor played neither side");
    assert.equal(reviewed.whiteName, "Ada");
    assert.equal(reviewed.blackName, "Bob");
    assert.equal(reviewed.result.status, "resign");
    assert.equal(reviewed.result.winner, "white");
    assert.equal(reviewed.initialBoard.turn, "white");
    assert.deepEqual(reviewed.moves.map((move) => move.pgn), ["e4"]);

    // A player of the game is told which side they had.
    const player = new TestClient(`ws://${origin}/ws`);
    clients.push(player);
    await player.ready;
    await player.next("welcome");
    player.send({
      type: "rejoin",
      gameId: firstMatch.gameId,
      playerId: firstMatch.color === "white" ? "ada" : "bob",
    });
    assert.equal((await player.next("reviewed")).color, firstMatch.color);
  } finally {
    for (const client of clients) client.close();
    await running.server.shutdown();
  }
});

Deno.test("a game is drawn once both players have offered one", async () => {
  const { running, origin } = startLocalServer();
  const clients: TestClient[] = [];

  try {
    const first = new TestClient(`ws://${origin}/ws`);
    const second = new TestClient(`ws://${origin}/ws`);
    clients.push(first, second);
    await Promise.all([first.ready, second.ready]);
    await Promise.all([first.next("welcome"), second.next("welcome")]);

    first.send({ type: "join", complexity: 0, timeControl: 0, name: "Ada" });
    second.send({ type: "join", complexity: 0, timeControl: 0, name: "Bob" });
    const [firstMatch] = await Promise.all([
      first.next("matched"),
      second.next("matched"),
    ]);

    first.send({ type: "offerDraw" });
    // Both players hear who offered, including the one that did.
    assert.equal((await first.next("drawOffered")).color, firstMatch.color);
    assert.equal((await second.next("drawOffered")).color, firstMatch.color);

    second.send({ type: "offerDraw" });
    const drawn = await first.next("gameOver");
    assert.equal(drawn.status, "draw");
    assert.equal(drawn.winner, "draw");
    assert.equal((await second.next("gameOver")).status, "draw");

    // The game is over, so a further offer is refused rather than drawing.
    first.send({ type: "offerDraw" });
    assert.match((await first.next("error")).message, /not in a game/);
  } finally {
    for (const client of clients) client.close();
    await running.server.shutdown();
  }
});

Deno.test("a client that is not playing is told so, and survives nonsense", async () => {
  const { running, origin } = startLocalServer();
  const client = new TestClient(`ws://${origin}/ws`);

  try {
    await client.ready;
    await client.next("welcome");

    client.send({ type: "resign" });
    assert.match((await client.next("error")).message, /not in a game/);

    // Nonsense that is not even a message is refused without dropping the
    // socket, so a buggy client can carry on.
    client.socket.send("hello?");
    assert.match((await client.next("error")).message, /must be JSON/);

    client.send({ type: "join", complexity: 2, timeControl: 0, name: "Ada" });
    assert.equal((await client.next("queued")).complexity, 2);
  } finally {
    client.close();
    await running.server.shutdown();
  }
});

Deno.test("the clocks are sent after every move", async () => {
  const { running, origin } = startLocalServer();
  const clients: TestClient[] = [];

  try {
    const first = new TestClient(`ws://${origin}/ws`);
    const second = new TestClient(`ws://${origin}/ws`);
    clients.push(first, second);
    await Promise.all([first.ready, second.ready]);
    await Promise.all([first.next("welcome"), second.next("welcome")]);

    first.send({ type: "join", complexity: 0, timeControl: 0, name: "Ada" });
    second.send({ type: "join", complexity: 0, timeControl: 0, name: "Bob" });
    const [firstMatch] = await Promise.all([
      first.next("matched"),
      second.next("matched"),
    ]);
    const white = firstMatch.color === "white" ? first : second;

    white.send({
      type: "move",
      pieceId: 4,
      from: { x: 4, y: 1 },
      to: { x: 4, y: 3 },
    });
    await white.next("moved");

    // White's first move is free, and black has not moved yet either, so no
    // clock is running; white's increment has already been added.
    const clock = await white.next("clock");
    assert.equal(clock.running, null);
    assert.equal(clock.white, 62_000);
    assert.equal(clock.black, 60_000);
  } finally {
    for (const client of clients) client.close();
    await running.server.shutdown();
  }
});

Deno.test("a game can be called off before either player has moved", async () => {
  const { running, origin } = startLocalServer();
  const clients: TestClient[] = [];

  try {
    const first = new TestClient(`ws://${origin}/ws`);
    const second = new TestClient(`ws://${origin}/ws`);
    clients.push(first, second);
    await Promise.all([first.ready, second.ready]);
    await Promise.all([first.next("welcome"), second.next("welcome")]);

    first.send({ type: "join", complexity: 0, timeControl: 0, name: "Ada" });
    second.send({ type: "join", complexity: 0, timeControl: 0, name: "Bob" });
    await Promise.all([first.next("matched"), second.next("matched")]);

    first.send({ type: "abort" });
    const aborted = await first.next("gameOver");
    assert.equal(aborted.status, "abort");
    assert.equal(aborted.winner, null);
    assert.equal((await second.next("gameOver")).status, "abort");

    // The game is over, so there is nothing left to call off.
    first.send({ type: "abort" });
    assert.match((await first.next("error")).message, /not in a game/);
  } finally {
    for (const client of clients) client.close();
    await running.server.shutdown();
  }
});

Deno.test({
  name: "a game survives the server being restarted",
  ignore: redisUrl === undefined || databaseUrl === undefined,
  fn: async () => {
    const clients: TestClient[] = [];
    const first = await startPersistentServer();
    let gameId: string | null = null;

    try {
      const a = new TestClient(`ws://${first.origin}/ws`);
      const b = new TestClient(`ws://${first.origin}/ws`);
      clients.push(a, b);
      await Promise.all([a.ready, b.ready]);
      await Promise.all([a.next("welcome"), b.next("welcome")]);

      a.send({
        type: "join",
        complexity: 0,
        timeControl: 0,
        name: "Ada",
        playerId: "restart-a",
      });
      b.send({
        type: "join",
        complexity: 0,
        timeControl: 0,
        name: "Bob",
        playerId: "restart-b",
      });
      const [aMatch] = await Promise.all([
        a.next("matched"),
        b.next("matched"),
      ]);
      gameId = aMatch.gameId;

      const white = aMatch.color === "white" ? a : b;
      const black = aMatch.color === "white" ? b : a;
      white.send({
        type: "move",
        pieceId: 4,
        from: { x: 4, y: 1 },
        to: { x: 4, y: 3 },
      });
      await white.next("moved");
      await black.next("moved");

      // Let the write the lobby made without waiting for it reach Redis, then
      // take the whole process away, as a restart would.
      await settle();
      for (const client of clients) client.close();
      await first.running.server.shutdown();

      // A new server over the same stores restores the game it finds there.
      const second = await startPersistentServer();
      try {
        const again = new TestClient(`ws://${second.origin}/ws`);
        const opponent = new TestClient(`ws://${second.origin}/ws`);
        clients.push(again, opponent);
        await Promise.all([again.ready, opponent.ready]);
        await Promise.all([again.next("welcome"), opponent.next("welcome")]);

        again.send({
          type: "rejoin",
          gameId,
          playerId: "restart-a",
        });
        const resumed = await again.next("resumed");
        assert.equal(resumed.gameId, gameId);
        assert.equal(resumed.color, aMatch.color);
        assert.equal(resumed.board.turn, "black");
        assert.ok(resumed.clock.white > 60_000, "the move was remembered");

        // The opponent takes their seat too, and the game carries on.
        opponent.send({
          type: "rejoin",
          gameId,
          playerId: "restart-b",
        });
        await opponent.next("resumed");
        opponent.send({
          type: "move",
          pieceId: 12,
          from: { x: 4, y: 6 },
          to: { x: 4, y: 4 },
        });
        assert.equal((await opponent.next("moved")).pgn, "e5");
        assert.equal((await again.next("moved")).pgn, "e5");
      } finally {
        await second.running.server.shutdown();
      }
    } finally {
      if (gameId !== null) await first.games.remove(gameId);
      for (const client of clients) client.close();
    }
  },
});
