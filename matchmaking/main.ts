import {
  PROTOCOL_VERSION,
  type ServerMessage,
} from "../src/online/protocol.ts";
import { timeControlLabel, timeControls } from "../src/online/time-controls.ts";
import { chaosLevels } from "../src/replacement-rules.ts";
import { type Client, Lobby } from "./lobby.ts";
import { maxComplexity, minComplexity } from "./matchmaking.ts";
import { parseClientMessage } from "./parse.ts";
import { PostgresPlayerStore } from "./postgres-store.ts";
import { RedisGameStore } from "./redis-store.ts";
import type { GameStore, PlayerStore } from "./store.ts";

/** `WebSocket.OPEN`, spelled out so no DOM global is needed at load time. */
const openReadyState = 1;

/** A default port and heartbeat, overridable through the environment. */
const defaultPort = 8000;
const defaultHeartbeatMs = 30_000;
const defaultMaxMessageBytes = 8192;

/**
 * How often the games' clocks are checked.
 *
 * The flag itself is decided from the wall clock, so this only sets how finely
 * a clock that has run out is noticed, and how often the players are reminded
 * what their clocks say.
 */
const clockTickMs = 250;

export interface ServerOptions {
  port?: number;
  hostname?: string;
  /**
   * The origins allowed to open a socket. An empty list accepts every origin,
   * which is convenient in development and unsafe on a public host.
   */
  allowedOrigins?: string[];
  /** How often a keepalive is sent, in milliseconds. Zero disables them. */
  heartbeatMs?: number;
  /** The largest message accepted from a client, in UTF-16 code units. */
  maxMessageBytes?: number;
  /**
   * The lobby to run. A deployment builds one with its stores and restores the
   * games in progress before handing it over; a test lets the server make its
   * own, which keeps everything in memory.
   */
  lobby?: Lobby;
  /** Overridable for tests, which want deterministic colours and settings. */
  random?: () => number;
}

export interface RunningServer {
  server: Deno.HttpServer;
  lobby: Lobby;
}

/**
 * One connected client, over a single socket.
 *
 * `send` is silent on a socket that is closing, so the lobby never has to think
 * about the transport's state.
 */
class Connection implements Client {
  readonly id: string;
  lastSeenAt: number;
  private readonly socket: WebSocket;

  constructor(socket: WebSocket, now: number) {
    this.id = crypto.randomUUID();
    this.lastSeenAt = now;
    this.socket = socket;
  }

  send(message: ServerMessage): void {
    if (this.socket.readyState === openReadyState) {
      this.socket.send(JSON.stringify(message));
    }
  }

  close(code: number, reason: string): void {
    if (this.socket.readyState === openReadyState) {
      this.socket.close(code, reason);
    }
  }
}

/**
 * Starts the matchmaking server.
 *
 * The lobby lives in this process, so the server has to run as a single
 * instance: two instances would hold two queues and could not pair players
 * waiting on the other one.
 */
export function startServer(options: ServerOptions = {}): RunningServer {
  const port = options.port ?? defaultPort;
  const hostname = options.hostname ?? "0.0.0.0";
  const allowedOrigins = options.allowedOrigins ?? [];
  const heartbeatMs = options.heartbeatMs ?? defaultHeartbeatMs;
  const maxMessageBytes = options.maxMessageBytes ?? defaultMaxMessageBytes;
  const random = options.random;

  const lobby = options.lobby ?? new Lobby(random ? { random } : {});
  const connections = new Set<Connection>();

  const upgrade = (request: Request): Response => {
    if (
      allowedOrigins.length > 0 && !isAllowedOrigin(request, allowedOrigins)
    ) {
      return new Response("Origin not allowed", { status: 403 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    const { socket, response } = Deno.upgradeWebSocket(request);
    const connection = new Connection(socket, Date.now());
    connections.add(connection);

    socket.onopen = () => connection.send(welcomeMessage());
    socket.onmessage = (event) => {
      connection.lastSeenAt = Date.now();
      if (typeof event.data !== "string") {
        connection.send({
          type: "error",
          message: "Only text frames are supported.",
        });
        return;
      }
      if (event.data.length > maxMessageBytes) {
        connection.send({ type: "error", message: "Message too large." });
        return;
      }
      const parsed = parseClientMessage(event.data);
      if (!parsed.ok) {
        connection.send({ type: "error", message: parsed.error });
        return;
      }
      try {
        lobby.handleMessage(connection, parsed.message);
      } catch (error) {
        console.error("Failed to handle a client message:", error);
        connection.send({ type: "error", message: "Internal server error." });
      }
    };
    const forget = () => {
      if (!connections.delete(connection)) return;
      lobby.disconnect(connection);
    };
    socket.onclose = forget;
    socket.onerror = forget;

    return response;
  };

  const handle = (request: Request): Response => {
    const { pathname } = new URL(request.url);
    if (pathname === "/ws") return upgrade(request);
    if (pathname === "/" || pathname === "/health") {
      return Response.json({
        name: "fairy-chess-matchmaking",
        protocolVersion: PROTOCOL_VERSION,
        waiting: lobby.waitingCount,
        games: lobby.gameCount,
        connections: connections.size,
      });
    }
    return new Response("Not found", { status: 404 });
  };

  const server = Deno.serve(
    {
      port,
      hostname,
      onListen: ({ hostname, port }) => {
        console.log(`fairy-chess matchmaking listening on ${hostname}:${port}`);
      },
    },
    handle,
  );

  if (heartbeatMs > 0) {
    const timer = setInterval(() => {
      const cutoff = Date.now() - heartbeatMs * 2;
      for (const connection of connections) {
        if (connection.lastSeenAt < cutoff) {
          connection.close(1001, "keepalive timeout");
          continue;
        }
        connection.send({ type: "ping" });
      }
    }, heartbeatMs);
    // Deno's timers hand back a numeric handle, which is what `unrefTimer`
    // takes. The Node definitions an editor loads alongside the Deno ones, for
    // the tests' `node:assert`, describe an object instead, so the handle is
    // named here as the number it really is.
    Deno.unrefTimer(timer as unknown as number);
  }

  // The clock is the one thing the lobby cannot work out for itself: which
  // games have run out of time is a fact about the wall clock, so it is told
  // the time on a timer rather than on every message.
  const clockTimer = setInterval(() => lobby.tick(), clockTickMs);
  Deno.unrefTimer(clockTimer as unknown as number);

  if (allowedOrigins.length === 0) {
    console.warn(
      "ALLOWED_ORIGINS is empty: any origin may open a socket. " +
        "Set it to the site's origin in production.",
    );
  }

  return { server, lobby };
}

function welcomeMessage(): ServerMessage {
  return {
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    minComplexity,
    maxComplexity,
    complexityLabels: chaosLevels.map((level) => level.label),
    timeControlLabels: timeControls.map(timeControlLabel),
  };
}

/**
 * Whether a request may be upgraded.
 *
 * A request without an `Origin` is accepted either way: the check exists to
 * stop other websites from opening sockets in a visitor's browser, and clients
 * that are not browsers cannot be a visitor's browser.
 */
function isAllowedOrigin(request: Request, allowedOrigins: string[]): boolean {
  const origin = request.headers.get("origin");
  return origin === null || allowedOrigins.includes(origin);
}

if (import.meta.main) {
  await runFromEnvironment();
}

/**
 * Builds the lobby from the environment, restores the games that were running,
 * and starts serving. The stores are optional: a deployment that names none
 * keeps its games in memory, as it did before there was anywhere to keep them.
 */
async function runFromEnvironment(): Promise<void> {
  const games = await openGameStore(Deno.env.get("REDIS_URL"));
  const players = await openPlayerStore(Deno.env.get("DATABASE_URL"));

  const lobby = new Lobby({ games, players });
  if (games) {
    try {
      await lobby.restore();
    } catch (error) {
      console.error("Could not restore the games in progress:", error);
    }
  }

  startServer({
    port: readPort(Deno.env.get("PORT")),
    hostname: Deno.env.get("HOST") || "0.0.0.0",
    allowedOrigins: readOrigins(Deno.env.get("ALLOWED_ORIGINS")),
    heartbeatMs: readCount(Deno.env.get("HEARTBEAT_MS"), defaultHeartbeatMs, 0),
    maxMessageBytes: readCount(
      Deno.env.get("MAX_MESSAGE_BYTES"),
      defaultMaxMessageBytes,
    ),
    lobby,
  });
}

/**
 * The game store named by the environment, or nothing when it names none or the
 * server cannot be reached. A deployment keeps running without it: the games
 * are then held in memory, and the failure is logged rather than fatal.
 */
async function openGameStore(
  url: string | undefined,
): Promise<GameStore | undefined> {
  if (!url) return undefined;
  try {
    return await RedisGameStore.open(url);
  } catch (error) {
    console.error("Could not reach Redis, so games will not be stored:", error);
    return undefined;
  }
}

/** The player store named by the environment, or nothing when it names none. */
async function openPlayerStore(
  url: string | undefined,
): Promise<PlayerStore | undefined> {
  if (!url) return undefined;
  try {
    return await PostgresPlayerStore.open(url);
  } catch (error) {
    throw new Error(
      "Could not reach PostgreSQL" + error,
    );
  }
}

/** The port named by the environment, falling back to the default. */
function readPort(value: string | undefined): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535
    ? port
    : defaultPort;
}

/** The origins named by the environment, of which there may be none. */
function readOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * A whole number from the environment, or the fallback when it is missing or
 * unusable. `minimum` is the smallest value accepted, so a setting whose zero
 * means something — a disabled heartbeat — can be given one.
 */
function readCount(
  value: string | undefined,
  fallback: number,
  minimum: number = 1,
): number {
  const count = Number(value);
  return Number.isInteger(count) && count >= minimum ? count : fallback;
}
