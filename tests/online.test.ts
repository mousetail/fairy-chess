import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage } from "../src/online/protocol.ts";
import { parseServerMessage } from "../src/online/protocol.ts";
import { MatchmakingClient } from "../src/online/client.ts";
import { gameHash, gameIdFromHash } from "../src/online/game-link.ts";
import {
  type IdentityStore,
  loadPlayerId,
} from "../src/online/player-identity.ts";
import { FakeSocket } from "./fake-socket.ts";

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

  client.join(2, 1, "Ada");
  client.resign();
  assert.deepEqual(
    socket.sent,
    [],
    "nothing may be sent before the socket is up",
  );

  socket.emit("open", {});
  assert.deepEqual(socket.sent, [
    '{"type":"join","complexity":2,"timeControl":1,"name":"Ada"}',
    '{"type":"resign"}',
  ]);
});

test("an unnamed player joins without a name field", () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);
  socket.emit("open", {});

  client.join(0, 2, "   ");
  assert.deepEqual(socket.sent, [
    '{"type":"join","complexity":0,"timeControl":2}',
  ]);
});

test("a player joins under the identifier the browser keeps", () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);
  socket.emit("open", {});

  client.join(2, 1, "Ada", "player-ada");
  assert.deepEqual(socket.sent, [
    '{"type":"join","complexity":2,"timeControl":1,"name":"Ada",' +
    '"playerId":"player-ada"}',
  ]);
});

test("taking a seat back names the game and the player", () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);
  socket.emit("open", {});

  client.rejoin("game-7", "player-ada");
  assert.deepEqual(socket.sent, [
    '{"type":"rejoin","gameId":"game-7","playerId":"player-ada"}',
  ]);
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

test("a draw offer is sent as an offer, so it can be matched", () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);
  socket.emit("open", {});

  client.offerDraw();
  assert.deepEqual(socket.sent, ['{"type":"offerDraw"}']);
});

test("taking a draw offer back is sent as a cancellation", () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);
  socket.emit("open", {});

  client.cancelDraw();
  assert.deepEqual(socket.sent, ['{"type":"cancelDraw"}']);
});

test("calling a game off is sent as an abort", () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);
  socket.emit("open", {});

  client.abort();
  assert.deepEqual(socket.sent, ['{"type":"abort"}']);
});

test("an unreachable server is reported by ready", async () => {
  const socket = new FakeSocket();
  const { client } = clientOver(socket);

  socket.emit("error", {});
  await assert.rejects(client.ready, /Could not reach the matchmaking server/);

  client.join(1, 0);
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
  assert.equal(
    (parseServerMessage('{"type":"resumed"}') as ServerMessage).type,
    "resumed",
  );
  assert.equal(
    parseServerMessage('{"type":"drawOffered","color":"white"}')?.type,
    "drawOffered",
  );
  assert.equal(
    parseServerMessage('{"type":"drawCancelled","color":"white"}')?.type,
    "drawCancelled",
  );
  assert.equal(parseServerMessage('{"type":"goodbye"}'), undefined);
  // An array is an object, so it has to be turned away by hand.
  assert.equal(parseServerMessage("[]"), undefined);
  assert.equal(parseServerMessage("null"), undefined);
  assert.equal(parseServerMessage("not json at all"), undefined);
  assert.equal(parseServerMessage(7), undefined);
  assert.equal(parseServerMessage(undefined), undefined);
});

/** An in-memory stand-in for local storage. */
class MemoryStore implements IdentityStore {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("a player identifier is made once and then kept", () => {
  const store = new MemoryStore();
  const first = loadPlayerId(store);
  assert.ok(first.length > 0);
  assert.equal(loadPlayerId(store), first);

  // A stored value that is not a usable identifier is replaced rather than used.
  store.setItem("fairy-chess.playerId", "not a valid id!");
  const replaced = loadPlayerId(store);
  assert.notEqual(replaced, "not a valid id!");
  assert.equal(loadPlayerId(store), replaced);
});

test("a game link names a game in the address bar", () => {
  assert.equal(gameIdFromHash("#abc-123"), "abc-123");
  assert.equal(gameHash("abc-123"), "#abc-123");
  // A link an older build wrote is still read.
  assert.equal(gameIdFromHash("#/game/abc-123"), "abc-123");
  assert.equal(gameIdFromHash("#/game/"), null);
  assert.equal(gameIdFromHash("#something else"), null);
  assert.equal(gameIdFromHash("#"), null);
  assert.equal(gameIdFromHash(""), null);
});
