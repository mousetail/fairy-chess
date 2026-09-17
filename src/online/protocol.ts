import type { Tile } from "../chess-tile.ts";
import type { SerializedBoardState, SerializedMove } from "./serialization.ts";

/**
 * The messages exchanged with the matchmaking server.
 *
 * The server owns the game: it picks the settings, builds the starting
 * position, runs the clocks, and only relays a move once it has checked it
 * against the board it holds. Clients are expected to generate their own
 * candidate moves (they share the same rules code) so the board stays
 * responsive, but a move they send is only a request until the server accepts
 * it.
 */

/**
 * The wire protocol version. Bumped whenever a message shape changes, or a
 * message gains a value that an older client would read wrongly.
 */
export const PROTOCOL_VERSION = 6;

export type Color = "white" | "black";

/**
 * A move as it is replayed: whose it was, how it is written, and the move
 * itself in the board's own terms.
 *
 * A game's moves are stored as a PGN, so replaying one means matching each move
 * of the list against the board it was played on. That is what this is for: the
 * result of that matching, which a client can apply without repeating it.
 */
export interface SerializedPlay {
  color: Color;
  pgn: string;
  move: SerializedMove;
}

/**
 * The longest player identifier accepted, and the characters one may hold.
 *
 * An identifier is opaque to the server: the browser makes one and keeps it, and
 * the server only ever stores it. The pattern is there to keep anything strange
 * out of a database key, not to give the identifier a meaning.
 */
const playerIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether `value` may be used as a player identifier. */
export function isPlayerId(value: unknown): value is string {
  return typeof value === "string" && playerIdPattern.test(value);
}

export type GameOverStatus =
  | "checkmate"
  | "stalemate"
  /** The same position three times over, which is played out as a draw. */
  | "repetition"
  | "resign"
  | "draw"
  /** A player's clock ran out. */
  | "timeout"
  /** The game was called off before either player had made a move. */
  | "abort";

export type GameResult = {
  status: GameOverStatus;
  /**
   * The side that won, `"draw"` for a drawn game, or `null` when there is no
   * result at all — an aborted game.
   */
  winner: Color | "draw" | null;
};

/** What each clock has left, and whose is running. */
export interface ClockState {
  white: number;
  black: number;
  running: Color | null;
}

/** The clocks a game is played with, as the server decided them. */
export interface TimeControlSpec {
  /** The index into `timeControls` in `./time-controls.ts`. */
  index: number;
  /** The label the time control is known by, e.g. `"3+2"`. */
  label: string;
  /** The milliseconds each player starts with. */
  initialMs: number;
  /** The milliseconds added to a player's clock after each of their moves. */
  incrementMs: number;
}

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
   * Ask to be matched. `complexity` is an index into the chaos levels and
   * `timeControl` an index into the time controls; the server may pair the
   * player with anyone up to two steps away on either, since a game one step
   * from each player's request is played at the step in between.
   *
   * `playerId` is the identifier this browser keeps for itself; the server
   * records the player under it, and echoes it back in `matched` so a browser
   * that had none learns the one it was given.
   */
  | {
    type: "join";
    complexity: number;
    timeControl: number;
    name?: string;
    playerId?: string;
  }
  /**
   * Take back a seat at a game that is still running, after a reload or a lost
   * connection. The seat is the one held for `playerId`; a game nobody is
   * sitting at is still running until its clocks run out.
   */
  | { type: "rejoin"; gameId: string; playerId: string }
  /** Leave the queue without waiting for an opponent. */
  | { type: "cancelQueue" }
  | ({ type: "move" } & MoveRequest)
  /** End the game in the opponent's favour. */
  | { type: "resign" }
  /**
   * Call the game off, which is only allowed before this player has moved. The
   * game ends with no result rather than in a loss.
   */
  | { type: "abort" }
  /**
   * Offer a draw. The offer stands until the opponent offers one too, which
   * ends the game drawn, or until this player takes it back with a
   * `cancelDraw`.
   */
  | { type: "offerDraw" }
  /**
   * Take back a draw offer this player made. The opponent may still offer one
   * of their own, which the game is drawn on once this player offers again.
   */
  | { type: "cancelDraw" }
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
      timeControlLabels: string[];
    }
  | { type: "queued"; complexity: number; timeControl: number; waiting: number }
  | { type: "queueCancelled" }
  | {
      type: "matched";
      gameId: string;
      /** This client's own identifier, which it should keep for a rejoin. */
      playerId: string;
      /** The colour this client plays. */
      color: Color;
      opponentName: string;
      /** The chaos level the server picked for this game. */
      complexity: number;
      complexityLabel: string;
      /** The clocks the server picked for this game. */
      timeControl: TimeControlSpec;
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
  | {
      type: "resumed";
      gameId: string;
      /** This client's own identifier, echoed so it keeps the same one. */
      playerId: string;
      /** The colour this client plays. */
      color: Color;
      /** The name this client plays under, as the seat was stored. */
      playerName: string;
      opponentName: string;
      complexity: number;
      complexityLabel: string;
      timeControl: TimeControlSpec;
      board: SerializedBoardState;
      /** What each clock has left right now. */
      clock: ClockState;
      /** The sides with a draw offer standing, if any. */
      drawOffers: Color[];
      /**
       * The game from its opening, so the move log and its positions can be put
       * back: the position the game started from, and every move played.
       */
      history: GameHistory;
    }
  /**
   * A finished game, sent to anyone who asks for it by its id.
   *
   * A game that has finished is out of the store the running ones live in, so
   * it is looked up among the recorded ones instead. Its moves are replayed from
   * the PGN the record holds, and both players are named from the player rows
   * their identifiers point at.
   */
  | {
      type: "reviewed";
      gameId: string;
      /** The side the viewer played, or `null` when they did not play this game. */
      color: Color | null;
      whiteName: string;
      blackName: string;
      complexity: number;
      complexityLabel: string;
      timeControl: TimeControlSpec;
      result: GameResult;
      /** The position the game started from. */
      initialBoard: SerializedBoardState;
      /** Every move, in order, ready to be applied to the opening position. */
      moves: SerializedPlay[];
    }
  /**
   * What each player's clock has left, and whose is running. Sent after every
   * move and again while a clock runs, so a client that ticked on its own
   * catches up with the server.
   */
  | ({ type: "clock" } & ClockState)
  /**
   * The opponent's connection went away. The game is not over: their clock runs
   * on, and they can take their seat back until it runs out.
   */
  | { type: "opponentAway"; color: Color }
  /** The opponent came back and is playing again. */
  | { type: "opponentBack"; color: Color }
  | { type: "moveRejected"; rejection: MoveRejection }
  /**
   * Someone offered a draw. Sent to both players, naming the side that offered,
   * so the offerer can tell its own offer from the opponent's.
   */
  | { type: "drawOffered"; color: Color }
  /**
   * Someone took their draw offer back, naming the side that did. Sent to both
   * players, so the opponent knows there is no longer an offer to accept.
   */
  | { type: "drawCancelled"; color: Color }
  | ({ type: "gameOver" } & GameResult)
  | { type: "error"; message: string }
  /** Keepalive; answer it with a `pong`. */
  | { type: "ping" };

/** A game from its opening, so a client can rebuild its history. */
export interface GameHistory {
  /** The position the game started from. */
  initialBoard: SerializedBoardState;
  /** Every move played so far, in order. */
  moves: SerializedPlay[];
}

/** Every `type` a server message can carry, for a cheap first check. */
const serverMessageTypes = new Set<string>([
  "welcome",
  "queued",
  "queueCancelled",
  "matched",
  "resumed",
  "reviewed",
  "moved",
  "clock",
  "moveRejected",
  "drawOffered",
  "drawCancelled",
  "gameOver",
  "opponentAway",
  "opponentBack",
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
