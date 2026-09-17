import type {
  ClockState,
  Color,
  TimeControlSpec,
} from "../src/online/protocol.ts";

/**
 * One game's clocks.
 *
 * A player's clock only runs once they have made a move: the first move each
 * side makes is free, so someone who is still reading the pieces is not punished
 * for it. After that the clock runs for whoever is to move, the way a chess
 * clock does.
 *
 * Nothing ticks. The time a player has left is worked out from the moment their
 * clock started whenever it is asked for, which keeps the server free of a timer
 * per game and lets a test drive the whole thing with a clock it controls.
 */

/**
 * The grace given to a player whose clock has reached zero.
 *
 * A move is only late once it is this far late, so a player whose move was in
 * flight when the clock ran out — or whose browser's clock drifts — is not
 * penalised for the network.
 */
export const flagGraceMs = 1000;

/** What each side has left, and whose clock is running. */
export type ClockSnapshot = ClockState;

/**
 * Everything needed to build a clock again after the server was restarted. The
 * running clock is kept as the moment it started rather than as a number of
 * milliseconds used, so it carries on running across the restart.
 */
export interface ClockRecord {
  /** The time each side had left when the record was taken. */
  remaining: Record<Color, number>;
  /** Whether each side has moved yet, and so whether its clock may run. */
  moved: Record<Color, boolean>;
  running: Color | null;
  /** The wall-clock moment the running clock started. */
  startedAt: number;
}

export class GameClock {
  readonly timeControl: TimeControlSpec;
  private readonly remaining: Record<Color, number>;
  private readonly moved: Record<Color, boolean>;
  private running: Color | null = null;
  private startedAt = 0;

  constructor(timeControl: TimeControlSpec, state?: ClockRecord) {
    this.timeControl = timeControl;
    this.remaining = state ? { ...state.remaining } : {
      white: timeControl.initialMs,
      black: timeControl.initialMs,
    };
    this.moved = state ? { ...state.moved } : { white: false, black: false };
    if (state) {
      this.running = state.running;
      this.startedAt = state.startedAt;
    }
  }

  /** The side whose clock is running, or `null` while none is. */
  get runningColor(): Color | null {
    return this.running;
  }

  /** Whether `color` has made a move yet, and so whether their clock may run. */
  hasMoved(color: Color): boolean {
    return this.moved[color];
  }

  /** What `color` has left at `now`, which may be negative within the grace. */
  remainingAt(color: Color, now: number): number {
    if (this.running !== color) return this.remaining[color];
    return this.remaining[color] - (now - this.startedAt);
  }

  /**
   * Records that `color` has just moved, and hands the clock on.
   *
   * The mover's clock is settled, the increment is added to it, and the next
   * side's clock starts — unless the next side has not moved yet, in which case
   * no clock runs at all and their first move stays free too.
   */
  afterMove(color: Color, next: Color, now: number): void {
    this.settle(now);
    this.moved[color] = true;
    this.remaining[color] += this.timeControl.incrementMs;
    this.start(next, now);
  }

  /**
   * The side that has run out of time at `now`, if any.
   *
   * Only the running clock can run out, and the grace is what makes a player
   * late: a move that arrives within it is still in time.
   */
  flagged(now: number): Color | null {
    const color = this.running;
    if (color === null) return null;
    return this.remainingAt(color, now) < -flagGraceMs ? color : null;
  }

  /** The times to show the players at `now`, which are never below zero. */
  snapshot(now: number): ClockSnapshot {
    return {
      white: Math.max(0, this.remainingAt("white", now)),
      black: Math.max(0, this.remainingAt("black", now)),
      running: this.running,
    };
  }

  /**
   * Everything needed to build this clock again, including the moment the
   * running one started, so a clock survives the server being restarted.
   */
  state(): ClockRecord {
    return {
      remaining: { white: this.remaining.white, black: this.remaining.black },
      moved: { white: this.moved.white, black: this.moved.black },
      running: this.running,
      startedAt: this.startedAt,
    };
  }

  /**
   * Marks `color` as gone: their free first move is over, and their clock runs
   * once it is their turn to move.
   *
   * A player who disconnects has nobody to read the pieces, so the free first
   * move no longer applies to them. Their clock is what ends a game they never
   * come back to, exactly as it ends one they stop playing.
   */
  absent(color: Color, toMove: Color, now: number): void {
    this.moved[color] = true;
    if (toMove !== color || this.running === color) return;
    this.start(color, now);
  }

  /** Starts `color`'s clock, if they have moved and so may be timed. */
  private start(color: Color, now: number): void {
    if (!this.moved[color]) {
      this.running = null;
      return;
    }
    this.running = color;
    this.startedAt = now;
  }

  /** Takes the time the running clock has used off it, if one is running. */
  private settle(now: number): void {
    if (this.running === null) return;
    this.remaining[this.running] -= now - this.startedAt;
    this.running = null;
  }
}
