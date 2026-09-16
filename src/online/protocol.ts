import type { Tile } from "../chess-tile.ts";
import type { SerializedBoardState, SerializedMove } from "./serialization.ts";

/**
 * The messages exchanged with the matchmaking server.
 *
 * The server owns the game: it picks the settings, builds the starting
 * position, and only relays a move once it has checked it against the board it
 * holds. Clients are expected to generate their own candidate moves (they share
 * the same rules code) so the board stays responsive, but a move they send is
 * only a request until the server accepts it.
 */

/** The wire protocol version. Bumped whenever a message shape changes. */
export const PROTOCOL_VERSION = 1;

export type Color = "white" | "black";

export type GameOverStatus = "checkmate" | "stalemate" | "resign" | "draw";

export type GameResult = {
  status: GameOverStatus;
  /** The side that won, or `"draw"` for a stalemate. */
  winner: Color | "draw";
};

/** Why the server refused a move. */
export type MoveRejection =
  | { reason: "game-over" }
  | { reason: "not-your-turn" }
  | { reason: "unknown-piece" }
  | { reason: "not-your-piece" }
  | { reason: "stale-position" }
  | { reason: "illegal-move" }
  /** The move reaches the far rank, so the client must say what to promote to. */
  | { reason: "promotion-required"; options: string[] };

/**
 * The squares a move names, and the piece making it.
 *
 * The server names the same fields in its own move handling, so a client can
 * hand a request straight to the lobby and the lobby can hand it straight on.
 */
export interface MoveRequest {
  pieceId: number;
  from: Tile;
  to: Tile;
  /** The piece type key to promote to, when the move reaches the far rank. */
  promotion?: string;
}

export type ClientMessage =
  /**
   * Ask to be matched. `complexity` is an index into the chaos levels; the
   * server may pair the player with anyone within one level of it.
   */
  | { type: "join"; complexity: number; name?: string }
  /** Leave the queue without waiting for an opponent. */
  | { type: "cancelQueue" }
  | ({ type: "move" } & MoveRequest)
  | { type: "resign" }
  /**
   * Offer a draw. The offer stands until the opponent offers one too, which
   * ends the game drawn; there is no way to take it back.
   */
  | { type: "offerDraw" }
  /** Answers the server's keepalive. */
  | { type: "pong" };

export type ServerMessage =
  /** Sent once, as soon as the connection is open. */
  | {
      type: "welcome";
      protocolVersion: number;
      minComplexity: number;
      maxComplexity: number;
      complexityLabels: string[];
    }
  | { type: "queued"; complexity: number; waiting: number }
  | { type: "queueCancelled" }
  | {
      type: "matched";
      gameId: string;
      /** The colour this client plays. */
      color: Color;
      opponentName: string;
      /** The chaos level the server picked for this game. */
      complexity: number;
      complexityLabel: string;
      /** The starting position, as laid out by the server. */
      board: SerializedBoardState;
    }
  | {
      type: "moved";
      color: Color;
      move: SerializedMove;
      /** The move in algebraic notation, for the move log. */
      pgn: string;
      /** The position after the move; the only board either client needs. */
      board: SerializedBoardState;
      /** Whether the side that must move next is in check. */
      inCheck: boolean;
    }
  | { type: "moveRejected"; rejection: MoveRejection }
  /**
   * Someone offered a draw. Sent to both players, naming the side that offered,
   * so the offerer can tell its own offer from the opponent's.
   */
  | { type: "drawOffered"; color: Color }
  | ({ type: "gameOver" } & GameResult)
  | { type: "opponentLeft"; winner: Color }
  | { type: "error"; message: string }
  /** Keepalive; answer it with a `pong`. */
  | { type: "ping" };

/** Every `type` a server message can carry, for a cheap first check. */
const serverMessageTypes = new Set<string>([
  "welcome",
  "queued",
  "queueCancelled",
  "matched",
  "moved",
  "moveRejected",
  "drawOffered",
  "gameOver",
  "opponentLeft",
  "error",
  "ping",
]);

/**
 * Reads a frame from the server, or returns undefined for anything that is not
 * a message this client understands.
 *
 * A socket carries whatever the other end sends, so nothing arriving here can
 * be taken on trust. The check stops short of the message bodies: a plausible
 * `board` is left to {@link deserializeBoardState}, which already rejects a
 * piece type it does not know.
 */
export function parseServerMessage(raw: unknown): ServerMessage | undefined {
  if (typeof raw !== "string") return undefined;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }

  // An array is an object too, so it has to be turned away explicitly.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !serverMessageTypes.has(type)) {
    return undefined;
  }
  return value as ServerMessage;
}
