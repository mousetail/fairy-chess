import type { GameResult } from "../src/online/protocol.ts";

/**
 * Players' ratings, followed quietly in the database.
 *
 * The rating is never sent to a client: it is kept so games can be paired and,
 * later, so a player's history can be shown. Nothing here is a rule of the game,
 * so the numbers are plain ELO, worked out the same way for both sides.
 */

/** The rating a player who has never finished a rated game starts at. */
export const startingRating = 1200;

/** How far one game can move a rating. */
export const kFactor = 32;

/** The score `rating` is expected to take from `opponent`, between 0 and 1. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/**
 * The ratings both sides come out of a finished game with.
 *
 * `score` is what each side took from the game: 1 for a win, 0.5 for a draw and
 * 0 for a loss. Ratings are whole numbers where players read them.
 */
export function updatedRatings(
  white: number,
  black: number,
  score: { white: number; black: number },
): { white: number; black: number } {
  const expectedWhite = expectedScore(white, black);
  return {
    white: Math.round(white + kFactor * (score.white - expectedWhite)),
    black: Math.round(black + kFactor * (score.black - (1 - expectedWhite))),
  };
}

/**
 * What each side took from a game, or `null` when the game decided nothing.
 *
 * A game that was called off, or one both players walked away from, changes no
 * rating: there is no result to be credited with.
 */
export function resultScores(
  result: GameResult,
): { white: number; black: number } | null {
  switch (result.winner) {
    case "white":
      return { white: 1, black: 0 };
    case "black":
      return { white: 0, black: 1 };
    case "draw":
      return { white: 0.5, black: 0.5 };
    case null:
      return null;
  }
}
