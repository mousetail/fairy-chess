/**
 * The time controls a game can be played at.
 *
 * A time control is the time each player starts with, plus the time added to
 * their clock after every move they make. The list is shared with the
 * matchmaking server, which decides the settings for a game, so both ends agree
 * on what an index means.
 */

/** One time control: minutes to start with, seconds added after each move. */
export interface TimeControl {
  /** The minutes each player starts with. */
  minutes: number;
  /** The seconds added to a player's clock after each of their moves. */
  incrementSeconds: number;
}

/** The time controls a player may ask for, in the order the slider shows them. */
export const timeControls: TimeControl[] = [
  { minutes: 1, incrementSeconds: 2 },
  { minutes: 3, incrementSeconds: 2 },
  { minutes: 5, incrementSeconds: 5 },
  { minutes: 10, incrementSeconds: 10 },
];

/** The label a time control is known by, e.g. `"3+2"`. */
export function timeControlLabel(control: TimeControl): string {
  return `${control.minutes}+${control.incrementSeconds}`;
}

/** The milliseconds a time control is played with. */
export function timeControlMs(control: TimeControl): {
  initialMs: number;
  incrementMs: number;
} {
  return {
    initialMs: control.minutes * 60_000,
    incrementMs: control.incrementSeconds * 1000,
  };
}

/** `index` kept to the time controls that exist. */
export function clampTimeControl(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(timeControls.length - 1, Math.max(0, Math.trunc(index)));
}
