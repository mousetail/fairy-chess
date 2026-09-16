import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage } from "../src/online/protocol.ts";
import { parseServerMessage } from "../src/online/protocol.ts";
import { MatchmakingClient } from "../src/online/client.ts";
import { resolveMatchmakingUrl } from "../src/online/config.ts";

type Listener = (event: { data?: unknown }) => void;

/** The server a production build falls back to. */
const PRODUCTION_URL = "wss://fairy-chess-matchmaking.mousetail.nl/ws";

/** A stand-in for `WebSocket`, driven by the test instead of by a server. */
class FakeSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit("close", {});
  }

  /** Fires everything registered for `type`, as the browser would. */
  emit(type: string, event: { data?: unknown }): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

/** A partial screen, for a test that wants to watch or break the messages. */
interface ScreenStub {
  onMessage?(message: ServerMessage): void;
  onClose?(): void;
}

/** A client over `socket`, collecting whatever reaches the screen. */
function clientOver(
  socket: FakeSocket,
  stub: ScreenStub = {},
): { client: MatchmakingClient; messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  const client = new MatchmakingClient(
    "ws://matchmaking.test/ws",
    {
      onMessage: (message) => {
        messages.push(message);
        stub.onMessage?.(message);
      },
      onClose: () => {
        stub.onClose?.();
      },
    },
    () => socket as unknown as WebSocket,
  );
  return { client, messages };
}

/** Runs `run` with the console quiet, for the paths that complain to it. */
function quietly(run: () => void): void {
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

test("a message sent before the socket opens is held until it does", () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);

  client.join(2, "Ada");
  client.resign();
  assert.deepEqual(
    socket.sent,
    [],
    "nothing may be sent before the socket is up",
  );

  socket.emit("open", {});
  assert.deepEqual(socket.sent, [
    '{"type":"join","complexity":2,"name":"Ada"}',
    '{"type":"resign"}',
  ]);
});

test("an unnamed player joins without a name field", () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);
  socket.emit("open", {});

  client.join(0, "   ");
  assert.deepEqual(socket.sent, ['{"type":"join","complexity":0}']);
});

test("a move is sent in the shape the server expects", () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);
  socket.emit("open", {});

  client.move({
    pieceId: 4,
    from: { x: 4, y: 1 },
    to: { x: 4, y: 3 },
    promotion: "rook",
  });
  assert.deepEqual(socket.sent, [
    '{"type":"move","pieceId":4,"from":{"x":4,"y":1},"to":{"x":4,"y":3},' +
    '"promotion":"rook"}',
  ]);
});

test("an unreachable server is reported by ready", async () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);

  socket.emit("error", {});
  await assert.rejects(client.ready, /Could not reach the matchmaking server/);

  client.join(1);
  socket.emit("open", {});
  assert.deepEqual(socket.sent, []);
});

test("a keepalive is answered without troubling the screen", () => {
  const socket = new FakeSocket();
  const { messages } = clientOver(socket);
  socket.emit("open", {});

  socket.emit("message", { data: '{"type":"ping"}' });
  assert.deepEqual(socket.sent, ['{"type":"pong"}']);
  assert.deepEqual(messages, []);
});

test("anything that is not a message this client knows is dropped", () => {
  const socket = new FakeSocket();
  const { messages } = clientOver(socket);
  socket.emit("open", {});

  quietly(() => {
    for (const data of ["", "{", "[]", "null", '"welcome"', 42, undefined]) {
      socket.emit("message", { data });
    }
    socket.emit("message", { data: '{"type":"goodbye"}' });
  });

  assert.deepEqual(messages, []);
});

test("a message the screen cannot handle does not take the socket down", () => {
  const socket = new FakeSocket();
  const { messages } = clientOver(socket, {
    onMessage: (message) => {
      if (message.type === "error") throw new Error("the screen gave up");
    },
  });
  socket.emit("open", {});

  quietly(() => {
    socket.emit("message", { data: '{"type":"error","message":"boom"}' });
    socket.emit("message", {
      data: '{"type":"queued","complexity":2,"waiting":1}',
    });
  });

  assert.deepEqual(
    messages.map((message) => message.type),
    ["error", "queued"],
  );
});

test("a socket that never opened does not report a lost connection", () => {
  const socket = new FakeSocket();
  let closes = 0;
  clientOver(socket, { onClose: () => closes++ });

  socket.emit("close", {});
  assert.equal(closes, 0);
});

test("a socket that closes itself is reported once", () => {
  const socket = new FakeSocket();
  let closes = 0;
  clientOver(socket, { onClose: () => closes++ });

  socket.emit("open", {});
  socket.emit("close", {});
  assert.equal(closes, 1);
});

test("closing on purpose is not reported as a lost connection", () => {
  const socket = new FakeSocket();
  let closes = 0;
  const { client } = clientOver(socket, { onClose: () => closes++ });

  socket.emit("open", {});
  client.dispose();
  assert.equal(closes, 0);
  assert.equal(socket.closed, true);

  client.resign();
  assert.deepEqual(socket.sent, []);
});

test("only messages with a type this build knows are accepted", () => {
  assert.equal(
    (parseServerMessage('{"type":"welcome"}') as ServerMessage).type,
    "welcome",
  );
  assert.equal(parseServerMessage('{"type":"goodbye"}'), undefined);
  // An array is an object, so it has to be turned away by hand.
  assert.equal(parseServerMessage("[]"), undefined);
  assert.equal(parseServerMessage("null"), undefined);
  assert.equal(parseServerMessage("not json at all"), undefined);
  assert.equal(parseServerMessage(7), undefined);
  assert.equal(parseServerMessage(undefined), undefined);
});

test("the matchmaking URL is taken from the environment when it is set", () => {
  assert.equal(
    resolveMatchmakingUrl("wss://example.test/ws", false),
    "wss://example.test/ws",
  );
  // A stray newline from a `.env` file must not reach the URL.
  assert.equal(
    resolveMatchmakingUrl("  ws://example.test/ws  ", true),
    "ws://example.test/ws",
  );
});

test("the matchmaking URL falls back to the well-known servers", () => {
  assert.equal(
    resolveMatchmakingUrl(undefined, true),
    "ws://localhost:8000/ws",
  );
  // An empty setting is no setting at all.
  assert.equal(resolveMatchmakingUrl("", true), "ws://localhost:8000/ws");
  assert.equal(resolveMatchmakingUrl("   ", true), "ws://localhost:8000/ws");
  assert.equal(resolveMatchmakingUrl("", false), PRODUCTION_URL);
  assert.equal(resolveMatchmakingUrl(undefined, false), PRODUCTION_URL);
});
