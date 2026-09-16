import type { Tile } from "../src/chess-tile.ts";
import type { ClientMessage } from "../src/online/protocol.ts";

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: string };

/**
 * Reads a message a client sent.
 *
 * Nothing arriving over the wire is trusted, so every field is checked here
 * before the lobby sees it. Only the shape is checked: whether a move is legal
 * is decided later, against the board.
 */
export function parseClientMessage(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid("Messages must be JSON.");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("Messages must be objects.");
  }
  const record = value as Record<string, unknown>;

  switch (record.type) {
    case "join": {
      if (typeof record.complexity !== "number") {
        return invalid("A join needs a numeric complexity.");
      }
      if (typeof record.timeControl !== "number") {
        return invalid("A join needs a numeric time control.");
      }
      if (record.name !== undefined && typeof record.name !== "string") {
        return invalid("A name must be a string.");
      }
      return {
        ok: true,
        message: {
          type: "join",
          complexity: record.complexity,
          timeControl: record.timeControl,
          name: record.name,
        },
      };
    }
    case "cancelQueue":
      return { ok: true, message: { type: "cancelQueue" } };
    case "move": {
      if (!Number.isInteger(record.pieceId)) {
        return invalid("A move needs an integer pieceId.");
      }
      const from = readTile(record.from);
      const to = readTile(record.to);
      if (!from || !to) {
        return invalid("A move needs on-board from and to squares.");
      }
      if (
        record.promotion !== undefined && typeof record.promotion !== "string"
      ) {
        return invalid("A promotion must name a piece type.");
      }
      return {
        ok: true,
        message: {
          type: "move",
          pieceId: record.pieceId as number,
          from,
          to,
          promotion: record.promotion,
        },
      };
    }
    case "resign":
      return { ok: true, message: { type: "resign" } };
    case "abort":
      return { ok: true, message: { type: "abort" } };
    case "offerDraw":
      return { ok: true, message: { type: "offerDraw" } };
    case "cancelDraw":
      return { ok: true, message: { type: "cancelDraw" } };
    case "pong":
      return { ok: true, message: { type: "pong" } };
    default:
      return invalid(`Unknown message type: ${String(record.type)}`);
  }
}

function invalid(error: string): ParseResult {
  return { ok: false, error };
}

/** Reads a board square, rejecting anything that is not on the board. */
function readTile(value: unknown): Tile | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  if (!isBoardCoordinate(x) || !isBoardCoordinate(y)) return null;
  return { x, y };
}

function isBoardCoordinate(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 &&
    (value as number) < 8;
}
