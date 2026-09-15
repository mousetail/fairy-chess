import { type SpecialMovement } from "../../chess-board";
import { type PieceType } from ".";
import {
  getPieceImageAsync,
  jumpBehavior,
  moveBehavior,
  type Behavior,
} from "../utils";

const knightDirections = [
  { x: -2, y: -1 },
  { x: -2, y: 1 },
  { x: 2, y: -1 },
  { x: 2, y: 1 },
  { x: -1, y: -2 },
  { x: -1, y: 2 },
  { x: 1, y: -2 },
  { x: 1, y: 2 },
];

const queenDirections = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

const queenRider = moveBehavior(queenDirections);

/** A rider along the knight's directions, i.e. a nightrider. */
const nightriderBehavior = moveBehavior(knightDirections);

/** Slides like a queen but only captures one square diagonally forward. */
const pylonBehavior: Behavior = (piece, state) => {
  const moves = queenRider(piece, state).filter((move) => move.type === "move");
  const forward = piece.color === "white" ? 1 : -1;
  const captures: SpecialMovement[] = [];
  for (const dx of [-1, 1]) {
    const to = { x: piece.position.x + dx, y: piece.position.y + forward };
    if (to.x < 0 || to.x > 7 || to.y < 0 || to.y > 7) continue;
    const target = state.pieces.find(
      (p) => p.position.x === to.x && p.position.y === to.y,
    );
    if (target && target.color !== piece.color) {
      captures.push({ to, type: "capture" });
    }
  }
  return [...moves, ...captures];
};

const diagonalSteps = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/**
 * A checkers tile. It steps one square diagonally, and it can jump a piece and
 * land on the square immediately beyond it; it captures whatever it lands on,
 * not the piece it jumps over. The jumped piece may be friend or foe. This is a
 * diagonal grasshopper, because Fairy-Stockfish cannot require the jumped piece
 * to be adjacent, so the hop clears the first piece on the diagonal however far
 * away it stands. Recorded as `mFgB` (fers plus a diagonal grasshopper).
 */
// const pseudocheckersBehavior: Behavior = (piece, state) => {
//   const pieces = state.pieces;
//   const pieceAt = (x: number, y: number) =>
//     pieces.find((p) => p.position.x === x && p.position.y === y);
//   const moves = jumpBehavior(diagonalSteps)(piece, state).filter(
//     (move) => move.type === "move",
//   );
//   for (const dir of diagonalSteps) {
//     let x = piece.position.x + dir.x;
//     let y = piece.position.y + dir.y;
//     // Find the first piece on this diagonal; that is the one to jump.
//     while (x >= 0 && x < 8 && y >= 0 && y < 8 && !pieceAt(x, y)) {
//       x += dir.x;
//       y += dir.y;
//     }
//     const landing = { x: x + dir.x, y: y + dir.y };
//     if (landing.x < 0 || landing.x > 7 || landing.y < 0 || landing.y > 7) {
//       continue;
//     }
//     const target = pieceAt(landing.x, landing.y);
//     if (!target) {
//       moves.push({ to: landing, type: "move" });
//     } else if (target.color !== piece.color) {
//       moves.push({ to: landing, type: "capture" });
//     }
//   }
//   return moves;
// };

/**
 * The basic fairy chess pieces. The leapers move a fixed distance and jump, so
 * they can never be blocked; the riders slide along their directions.
 *
 * Symbols follow the Fairy-Stockfish letters for their movement patterns where
 * one exists, and are otherwise free letters:
 *   wazir          = w
 *   ferz           = f
 *   camel          = c (chancellor also uses c; the per-game symbol map disambiguates)
 *   zebra          = z
 *   unicorn        = u
 *   pylon          = y
 *   pseudocheckers = o (fers + diagonal grasshopper has no standard letter, so o is a free one)
 *
 * The wazir and ferz are promotion priorities: a game that fields one of them
 * offers only that piece (or, when both are in play, the two of them) as
 * promotion targets.
 */
const fairyPieces = {
  wazir: {
    symbol: "w",
    betza: "W",
    promotionAbility: "priority",
    image: getPieceImageAsync("fantasy", "cyclops"),
    value: 2,
    displayName: "Wazir",
    description: "Moves one square horizontally or vertically.",
    diagram: {
      size: 5,
      rows: [".....", "..x..", ".xox.", "..x..", "....."],
    },
    behavior: jumpBehavior([
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]),
  },
  ferz: {
    symbol: "f",
    betza: "F",
    promotionAbility: "priority",
    image: getPieceImageAsync("fantasy", "archon"),
    value: 2,
    displayName: "Ferz",
    aliases: ["Fers"],
    description: "Moves one square diagonally.",
    diagram: {
      size: 5,
      rows: [".....", ".x.x.", "..o..", ".x.x.", "....."],
    },
    behavior: jumpBehavior([
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]),
  },
  camel: {
    symbol: "c",
    betza: "C",
    fallbackSymbols: ["m"],
    image: getPieceImageAsync("nature", "kangaroo"),
    value: 3,
    displayName: "Camel",
    description: "Leaps one square then three, over other pieces.",
    diagram: {
      size: 7,
      rows: [
        "..x.x..",
        ".......",
        "x.....x",
        "...o...",
        "x.....x",
        ".......",
        "..x.x..",
      ],
    },
    behavior: jumpBehavior([
      { x: 1, y: 3 },
      { x: 1, y: -3 },
      { x: -1, y: 3 },
      { x: -1, y: -3 },
      { x: 3, y: 1 },
      { x: 3, y: -1 },
      { x: -3, y: 1 },
      { x: -3, y: -1 },
    ]),
  },
  zebra: {
    symbol: "z",
    betza: "Z",
    image: getPieceImageAsync("nature", "zebra"),
    value: 3,
    displayName: "Zebra",
    description: "Leaps two squares then three, over other pieces.",
    diagram: {
      size: 7,
      rows: [
        ".x...x.",
        "x.....x",
        ".......",
        "...o...",
        ".......",
        "x.....x",
        ".x...x.",
      ],
    },
    behavior: jumpBehavior([
      { x: 2, y: 3 },
      { x: 2, y: -3 },
      { x: -2, y: 3 },
      { x: -2, y: -3 },
      { x: 3, y: 2 },
      { x: 3, y: -2 },
      { x: -3, y: 2 },
      { x: -3, y: -2 },
    ]),
  },
  unicorn: {
    symbol: "u",
    betza: "NN",
    image: getPieceImageAsync("fantasy", "unicorn"),
    value: 5,
    displayName: "Unicorn",
    aliases: ["Nightrider"],
    description: "Slides any number of squares along a knight's line.",
    diagram: {
      size: 7,
      rows: [
        ".......",
        "..x.x..",
        ".x...x.",
        "...o...",
        ".x...x.",
        "..x.x..",
        ".......",
      ],
    },
    behavior: nightriderBehavior,
  },
  pylon: {
    symbol: "y",
    betza: "mQcfF",
    image: getPieceImageAsync("fantasy", "pylon"),
    value: 5,
    displayName: "Pylon",
    description: "Slides like a queen; captures diagonally forward.",
    diagram: {
      size: 5,
      rows: ["x.x.x", ".cxc.", "xxoxx", ".xxx.", "x.x.x"],
    },
    behavior: pylonBehavior,
  },
  // pseudocheckers: {
  //   symbol: "o",
  //   betza: "mFgB",
  //   image: getPieceImageAsync("geometry", "circle"),
  //   value: 2,
  //   displayName: "Pseudocheckers Tile",
  //   aliases: ["Checkers Tile"],
  //   description:
  //     "Steps one square diagonally; jumps a piece to move or capture just beyond it.",
  //   diagram: {
  //     size: 5,
  //     rows: ["x...x", ".x.x.", "..o..", ".x.x.", "x...x"],
  //   },
  //   behavior: pseudocheckersBehavior,
  // },
} satisfies Record<string, PieceType>;

export default fairyPieces;
