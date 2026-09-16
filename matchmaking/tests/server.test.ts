import assert from "node:assert/strict";
import {
  type ClientMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "../../src/online/protocol.ts";
import { type RunningServer, startServer } from "../main.ts";

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
  });
  const address = running.server.addr;
  if (address.transport !== "tcp") throw new Error("expected a TCP listener");
  return { running, origin: `127.0.0.1:${address.port}` };
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

    // The two players ask for neighbouring levels, so they may be paired; the
    // game is then played at the less chaotic of the two.
    first.send({ type: "join", complexity: 0, name: "Ada" });
    second.send({ type: "join", complexity: 1, name: "Bob" });

    const [firstMatch, secondMatch] = await Promise.all([
      first.next("matched"),
      second.next("matched"),
    ]);
    assert.equal(firstMatch.gameId, secondMatch.gameId);
    assert.notEqual(firstMatch.color, secondMatch.color);
    assert.equal(firstMatch.complexity, 0);
    assert.equal(firstMatch.complexityLabel, "normal chess");
    assert.equal(firstMatch.opponentName, "Bob");
    assert.equal(secondMatch.opponentName, "Ada");
    assert.equal(firstMatch.board.pieces.length, 32);
    assert.equal(firstMatch.board.turn, "white");

    // A third player who asks for full chaos has nobody to play, so it waits.
    spectator.send({ type: "join", complexity: 4 });
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

Deno.test("a game is drawn once both players have offered one", async () => {
  const { running, origin } = startLocalServer();
  const clients: TestClient[] = [];

  try {
    const first = new TestClient(`ws://${origin}/ws`);
    const second = new TestClient(`ws://${origin}/ws`);
    clients.push(first, second);
    await Promise.all([first.ready, second.ready]);
    await Promise.all([first.next("welcome"), second.next("welcome")]);

    first.send({ type: "join", complexity: 0, name: "Ada" });
    second.send({ type: "join", complexity: 0, name: "Bob" });
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

    client.send({ type: "join", complexity: 2, name: "Ada" });
    assert.equal((await client.next("queued")).complexity, 2);
  } finally {
    client.close();
    await running.server.shutdown();
  }
});
