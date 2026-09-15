import type { ChessBoardState, Piece, SpecialMovement } from "../chess-board.ts";
import type { Tile } from "../chess-tile.ts";

/**
 * A piece's movement: given a piece and the board, the squares it may move to.
 * Moves are returned in absolute board coordinates.
 */
export type Behavior = (
  piece: Piece,
  state: ChessBoardState,
) => SpecialMovement[];

/**
 * One move pattern parsed from a Betza string. A single atom may expand into
 * several patterns, one per direction it applies to.
 */
interface MoveSpec {
  /** The direction, from white's point of view. */
  direction: Tile;
  /** Whether the pattern is a capture; otherwise it is a quiet move. */
  capture: boolean;
  kind: "step" | "rider" | "hopper" | "lame";
  /** Maximum distance; `0` means unlimited. */
  limit: number;
  /** Whether the pattern is only available before the piece has moved. */
  initial: boolean;
}

/**
 * The leaper atoms Fairy-Stockfish understands, as `[rank, file]` offsets. Note
 * that `L` and `C` are the same atom, as are `J` and `Z`.
 */
const LEAPER_ATOMS: Record<string, [number, number][]> = {
  W: [[1, 0]],
  F: [[1, 1]],
  D: [[2, 0]],
  N: [[2, 1]],
  A: [[2, 2]],
  H: [[3, 0]],
  L: [[3, 1]],
  C: [[3, 1]],
  J: [[3, 2]],
  Z: [[3, 2]],
  G: [[3, 3]],
  K: [
    [1, 0],
    [1, 1],
  ],
};

/** The rider atoms Fairy-Stockfish understands, as `[rank, file]` offsets. */
const RIDER_ATOMS: Record<string, [number, number][]> = {
  R: [[1, 0]],
  B: [[1, 1]],
  Q: [
    [1, 0],
    [1, 1],
  ],
};

/** The letters that select a vertical direction (forward or backward). */
const VERTICALS = "fbvh";
/** The letters that select a horizontal direction (left or right). */
const HORIZONTALS = "rlsh";

/**
 * For each of the eight directions of an atom, the direction modifiers that
 * select it. This mirrors the condition lists in Fairy-Stockfish's
 * `from_betza`, including its quirks (a bare `h` selects nothing).
 */
const DIRECTION_CONDITIONS: string[][] = [
  ["ff", "vv", "rf", "rv", "fh", "rh", "hr"],
  ["bb", "vv", "lb", "lv", "bh", "lh", "hr"],
  ["rr", "ss", "br", "bs", "bh", "rh", "hr"],
  ["ll", "ss", "fl", "fs", "fh", "lh", "hr"],
  ["rr", "ss", "fr", "fs", "fh", "rh", "hl"],
  ["ll", "ss", "bl", "bs", "bh", "lh", "hl"],
  ["bb", "vv", "rb", "rv", "bh", "rh", "hl"],
  ["ff", "vv", "lf", "lv", "fh", "lh", "hl"],
];

/**
 * The eight directions an atom can move in, in the order
 * {@link DIRECTION_CONDITIONS} lists them. The atom is given as
 * `[rank, file]`, so the offsets are `{ x: file, y: rank }`.
 */
function directionOffsets([rank, file]: [number, number]): Tile[] {
  return [
    { x: file, y: rank },
    { x: -file, y: -rank },
    { x: rank, y: -file },
    { x: -rank, y: file },
    { x: rank, y: file },
    { x: -rank, y: -file },
    { x: file, y: -rank },
    { x: -file, y: rank },
  ];
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

/**
 * Parses a Betza string into the move patterns it describes, following
 * Fairy-Stockfish's `from_betza`. Only the subset the engine supports is
 * understood; unknown characters (such as the `e` en-passant flag) are ignored.
 */
export function parseBetza(betza: string): MoveSpec[] {
  // Fairy-Stockfish stores the moves of a piece in maps keyed by direction, one
  // per movement kind, modality and initial flag, so a direction that several
  // atoms select is only stored once. Mirror that by keying the patterns the
  // same way and letting the last one win.
  const specs = new Map<string, MoveSpec>();
  let quiet = false;
  let capture = false;
  let hopper = false;
  let rider = false;
  let lame = false;
  let initial = false;
  let limit = 0;
  let prelimDirections: string[] = [];

  const reset = () => {
    quiet = false;
    capture = false;
    hopper = false;
    rider = false;
    lame = false;
    initial = false;
    limit = 0;
    prelimDirections = [];
  };

  for (let i = 0; i < betza.length; i++) {
    const character = betza[i];
    if (character === "m") {
      quiet = true;
    } else if (character === "c") {
      capture = true;
    } else if (character === "p") {
      hopper = true;
    } else if (character === "g") {
      hopper = true;
      limit = 1;
    } else if (character === "n") {
      lame = true;
    } else if (character === "i") {
      initial = true;
    } else if (
      VERTICALS.includes(character) ||
      HORIZONTALS.includes(character)
    ) {
      const next = betza[i + 1];
      if (
        next !== undefined &&
        (next === character ||
          (VERTICALS.includes(character) && HORIZONTALS.includes(next)) ||
          (HORIZONTALS.includes(character) && VERTICALS.includes(next)))
      ) {
        prelimDirections.push(character + next);
        i++;
      } else {
        prelimDirections.push(character + character);
      }
    } else if (LEAPER_ATOMS[character] || RIDER_ATOMS[character]) {
      const atoms = RIDER_ATOMS[character] ?? LEAPER_ATOMS[character];
      if (RIDER_ATOMS[character]) rider = true;
      const next = betza[i + 1];
      if (next !== undefined && (isDigit(next) || next === character)) {
        rider = true;
        if (isDigit(next)) limit = Number(next);
        i++;
      }
      if (!rider && lame) limit = -1;
      const kind = hopper ? "hopper" : rider ? "rider" : lame ? "lame" : "step";
      const modalities = quiet || capture ? [quiet, capture] : [true, true];
      for (const atom of atoms) {
        const directions: string[] = [];
        for (const direction of prelimDirections) {
          if (
            atoms.length === 1 &&
            atom[1] === 0 &&
            direction[0] !== direction[1]
          ) {
            directions.push(
              direction[0] + direction[0],
              direction[1] + direction[1],
            );
          } else {
            directions.push(direction);
          }
        }
        const offsets = directionOffsets(atom);
        for (let index = 0; index < offsets.length; index++) {
          if (
            directions.length > 0 &&
            !DIRECTION_CONDITIONS[index].some((d) => directions.includes(d))
          ) {
            continue;
          }
          for (let modality = 0; modality < 2; modality++) {
            if (!modalities[modality]) continue;
            const spec: MoveSpec = {
              direction: offsets[index],
              capture: modality === 1,
              kind,
              limit,
              initial,
            };
            specs.set(
              `${kind}|${spec.capture}|${initial}|${spec.direction.x},${spec.direction.y}`,
              spec,
            );
          }
        }
      }
      reset();
    }
  }

  return [...specs.values()];
}

/** The Chebyshev distance of a direction, as Fairy-Stockfish's `dist` computes it. */
function chebyshev(direction: Tile): number {
  return Math.max(Math.abs(direction.x), Math.abs(direction.y));
}

function inBounds(tile: Tile): boolean {
  return tile.x >= 0 && tile.y >= 0 && tile.x < 8 && tile.y < 8;
}

/** Rotates a white-relative direction into the given colour's frame. */
function rotate(direction: Tile, color: "black" | "white"): Tile {
  return color === "white"
    ? direction
    : { x: -direction.x, y: -direction.y };
}

/**
 * The squares a lame leaper passes over on its way to the atom's target,
 * following Fairy-Stockfish's `lame_leaper_path`. The path is white-relative.
 */
function lameLeaperPath([rank, file]: [number, number]): Tile[] {
  const path: Tile[] = [];
  const stepX = Math.sign(file);
  const stepY = Math.sign(rank);
  let x = 0;
  let y = 0;
  while (x !== file || y !== rank) {
    const difference = Math.abs(file - x) - Math.abs(rank - y);
    if (difference > 0) x += stepX;
    else if (difference < 0) y += stepY;
    else {
      x += stepX;
      y += stepY;
    }
    if (x !== file || y !== rank) path.push({ x, y });
  }
  return path;
}

export interface BetzaOptions {
  /**
   * Whether the piece may capture en passant. When set, the squares a pawn
   * passed over on its last double step count as capturable.
   */
  enPassant?: boolean;
}

/**
 * Builds a {@link Behavior} from a Betza string. The behaviour is written from
 * white's point of view in the notation and rotated for black, so `f` always
 * means "towards the enemy".
 */
export function betzaBehavior(
  betza: string,
  options: BetzaOptions = {},
): Behavior {
  const specs = parseBetza(betza);
  return (piece, state) => {
    const moves: SpecialMovement[] = [];
    for (const spec of specs) {
      if (spec.initial && piece.hasMoved) continue;
      const direction = rotate(spec.direction, piece.color);
      generateMoves(spec, direction, piece, state, options, moves);
    }
    // Several patterns may reach the same square (for example a rider and a
    // step in the same direction); Fairy-Stockfish merges those, so we do too.
    const seen = new Set<string>();
    return moves.filter((move) => {
      const key = `${move.to.x},${move.to.y},${move.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
}

function generateMoves(
  spec: MoveSpec,
  direction: Tile,
  piece: Piece,
  state: ChessBoardState,
  options: BetzaOptions,
  moves: SpecialMovement[],
): void {
  const origin = piece.position;
  const at = (distance: number): Tile => ({
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
  });
  const occupantAt = (tile: Tile): Piece | undefined =>
    state.pieces.find((p) => p.position.x === tile.x && p.position.y === tile.y);
  const isPassedTile = (tile: Tile): boolean =>
    !!options.enPassant &&
    !!state.lastMove?.passedTilesForEnPassant?.some(
      (passed) => passed.x === tile.x && passed.y === tile.y,
    );
  const push = (tile: Tile, capture: boolean): void => {
    if (capture === spec.capture) {
      moves.push({ to: tile, type: capture ? "capture" : "move" });
    }
  };

  if (spec.kind === "step" || spec.kind === "lame") {
    if (chebyshev(direction) > 3) return;
    const to = at(1);
    if (!inBounds(to)) return;
    if (spec.kind === "lame") {
      const path = lameLeaperPath([spec.direction.y, spec.direction.x]);
      const blocked = path.some((offset) => {
        const rotated = rotate(offset, piece.color);
        return occupantAt({ x: origin.x + rotated.x, y: origin.y + rotated.y });
      });
      if (blocked) return;
    }
    const occupant = occupantAt(to);
    if (occupant) {
      if (occupant.color !== piece.color) push(to, true);
    } else if (isPassedTile(to) && spec.capture) {
      // The passed square is empty, but an en-passant capture lands on it.
      push(to, true);
    } else {
      push(to, false);
    }
    return;
  }

  if (spec.kind === "rider") {
    if (chebyshev(direction) > 2) return;
    for (let distance = 1; spec.limit === 0 || distance <= spec.limit; distance++) {
      const to = at(distance);
      if (!inBounds(to)) break;
      const occupant = occupantAt(to);
      if (occupant) {
        if (occupant.color !== piece.color) push(to, true);
        break;
      }
      push(to, false);
    }
    return;
  }

  // Hopper: jump the first piece in the direction, then land on the squares
  // beyond it. A limit of 1 is a grasshopper, which lands on the first square
  // beyond the hurdle; a larger limit is the maximum distance from the origin.
  if (chebyshev(direction) > 2) return;
  let hurdleDistance = 0;
  for (let distance = 1; ; distance++) {
    const to = at(distance);
    if (!inBounds(to)) break;
    const occupant = occupantAt(to);
    if (hurdleDistance === 0) {
      if (occupant) hurdleDistance = distance;
      continue;
    }
    if (spec.limit > 0) {
      const maxDistance =
        spec.limit === 1 ? hurdleDistance + 1 : spec.limit;
      if (distance > maxDistance) break;
    }
    if (occupant) {
      if (occupant.color !== piece.color) push(to, true);
      break;
    }
    push(to, false);
  }
}
