import { chaosLevels } from "../src/replacement-rules.ts";

/**
 * Which waiting players may be paired, and what settings their game gets.
 *
 * Complexity is an index into {@link chaosLevels}: it says how many fairy
 * pieces the setup uses. A player is willing to play anyone within one level of
 * the level they asked for, and the game itself is then played at a level both
 * sides accept.
 */

/** The least chaotic level a player may ask for. */
export const minComplexity = 0;

/** The most chaotic level a player may ask for. */
export const maxComplexity = chaosLevels.length - 1;

/** Rounds `value` to a level a player may ask for. */
export function clampComplexity(value: number): number {
  if (!Number.isFinite(value)) return minComplexity;
  return Math.min(maxComplexity, Math.max(minComplexity, Math.trunc(value)));
}

/** Whether two players' preferences are close enough to be paired. */
export function canMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1;
}

/**
 * The level a game between two players is played at.
 *
 * Both players accept anything within one level of what they asked for, so the
 * game is played at the accepted level nearest to what they jointly asked for.
 * A tie goes to the less chaotic level, so the more cautious player's choice
 * wins.
 */
export function chooseComplexity(a: number, b: number): number {
  const lowest = Math.max(minComplexity, Math.min(a, b) - 1);
  const highest = Math.min(maxComplexity, Math.max(a, b) + 1);
  const average = (a + b) / 2;

  let best = lowest;
  for (let level = lowest + 1; level <= highest; level++) {
    if (Math.abs(level - average) < Math.abs(best - average)) best = level;
  }
  return best;
}
