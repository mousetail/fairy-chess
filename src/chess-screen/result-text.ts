import type { GameStatus } from "../chess-game.ts";
import type { Color } from "../online/protocol.ts";

/**
 * How a game ended. The local rules only ever reach the first three; only the
 * server can call a game on a resignation, an agreed draw, a flag or an abort.
 */
export type GameEndStatus =
  | GameStatus
  | "resign"
  | "draw"
  | "timeout"
  | "abort";

/** Whether a finished game was level, however it came to be level. */
export function isDrawn(status: GameEndStatus): boolean {
  return status === "stalemate" || status === "draw" ||
    status === "repetition";
}

/**
 * Why a finished game ended, for the line the score is followed by. The result
 * itself is on the board already, so this only says what the position cannot.
 *
 * `loser` is only ever missing for a game that was called off, which is
 * answered before a side would be named.
 */
export function describeResult(
  status: GameEndStatus,
  loser: Color | null,
): string | null {
  const side = loser === "black" ? "Black" : "White";
  switch (status) {
    case "checkmate":
      return "Checkmate";
    case "stalemate":
      return "Stalemate";
    case "repetition":
      return "3-fold repetition";
    case "draw":
      return "Draw by agreement";
    case "resign":
      return `${side} resigned`;
    case "timeout":
      return `${side} ran out of time`;
    case "abort":
      // Nothing was decided, and the score itself already reads "Aborted".
      return null;
  }
}
