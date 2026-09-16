import { chaosLevels } from "../src/replacement-rules.ts";
import { timeControls } from "../src/online/time-controls.ts";

/**
 * Which waiting players may be paired, and what settings their game gets.
 *
 * Complexity is an index into {@link chaosLevels}, which says how many fairy
 * pieces the setup uses. The time control is an index into `timeControls` in
 * `../src/online/time-controls.ts`, which says how fast the clock runs. Both
 * settings work the same way: a player is willing to play a game one step away
 * from the one they asked for, and the game itself is then played at a step
 * both sides accept. Two players may therefore be paired when their requests
 * are two steps apart, with the game played on the step in between; when they
 * are one apart, either of their requests is acceptable, so a coin decides.
 */

/** What a waiting player is looking for. */
export interface Preference {
  /** The chaos level the player asked for. */
  complexity: number;
  /** The index of the time control the player asked for. */
  timeControl: number;
}

/** The least chaotic level a player may ask for. */
export const minComplexity = 0;

/** The most chaotic level a player may ask for. */
export const maxComplexity = chaosLevels.length - 1;

/** The fastest time control a player may ask for. */
export const minTimeControl = 0;

/** The slowest time control a player may ask for. */
export const maxTimeControl = timeControls.length - 1;

/**
 * How far a game's setting may be from the one a player asked for.
 *
 * Each player accepts a game within this many steps of their own request, so a
 * pair fits when their requests are twice that far apart.
 */
const tolerance = 1;

/** Rounds `value` to a level a player may ask for. */
export function clampComplexity(value: number): number {
  if (!Number.isFinite(value)) return minComplexity;
  return Math.min(maxComplexity, Math.max(minComplexity, Math.trunc(value)));
}

/** Whether two players' preferences are close enough to be paired. */
export function canMatch(a: Preference, b: Preference): boolean {
  return Math.abs(a.timeControl - b.timeControl) <= 2 * tolerance &&
    Math.abs(a.complexity - b.complexity) <= 2 * tolerance;
}

/**
 * The step between two players' requests that their game is played at.
 *
 * Both players accept anything within {@link tolerance} of what they asked for,
 * so the game is played at an accepted step nearest to what they jointly asked
 * for. When they are one apart there are two such steps, and neither player's
 * request is favoured: `random` picks between them.
 */
function chooseSetting(
  a: number,
  b: number,
  lowest: number,
  highest: number,
  random: () => number,
): number {
  const from = Math.max(lowest, Math.min(a, b) - tolerance);
  const to = Math.min(highest, Math.max(a, b) + tolerance);
  const average = (a + b) / 2;

  const nearest: number[] = [];
  let bestDistance = Infinity;
  for (let step = from; step <= to; step++) {
    const distance = Math.abs(step - average);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest.length = 0;
    }
    if (distance === bestDistance) nearest.push(step);
  }
  return nearest[Math.floor(random() * nearest.length)];
}

/** The chaos level a game between two players is played at. */
export function chooseComplexity(
  a: number,
  b: number,
  random: () => number,
): number {
  return chooseSetting(a, b, minComplexity, maxComplexity, random);
}

/** The time control a game between two players is played at. */
export function chooseTimeControl(
  a: number,
  b: number,
  random: () => number,
): number {
  return chooseSetting(a, b, minTimeControl, maxTimeControl, random);
}
