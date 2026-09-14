import { type SpecialMovement } from "../chess-board";
import { type PieceType } from ".";
import { getPromotionOptions } from "./promotion";
import {
  getPieceImageAsync,
  jumpBehavior,
  moveBehavior,
  type Behavior,
} from "./utils";

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

const kingDirections = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
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

const kingJumps = jumpBehavior(kingDirections);
const queenRider = moveBehavior(queenDirections);

/**
 * Captures an adjacent enemy piece like a king, but never moves. A capture that
 * lands on the far rank promotes, so a wall that fights its way to the top can
 * still become a real piece.
 */
const wallBehavior: Behavior = (piece, state) => {
  const captures = kingJumps(piece, state).filter(
    (move) => move.type === "capture",
  );
  const lastRank = piece.color === "white" ? 7 : 0;
  const promotionOptions = getPromotionOptions(state);
  return captures.map((move) =>
    move.to.y === lastRank
      ? { ...move, promotion: { state: "pending", options: promotionOptions } }
      : move,
  );
};

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

/**
 * The basic fairy chess pieces. The leapers move a fixed distance and jump, so
 * they can never be blocked; the riders slide along their directions.
 *
 * Symbols follow the Fairy-Stockfish letters for their movement patterns where
 * one exists, and are otherwise free letters:
 *   wazir   = w
 *   ferz    = f
 *   camel   = c (chancellor also uses c; the per-game symbol map disambiguates)
 *   zebra   = z
 *   wall    = x
 *   unicorn = u
 *   pylon   = y
 *
 * The wazir and ferz are promotion priorities: a game that fields one of them
 * offers only that piece (or, when both are in play, the two of them) as
 * promotion targets. The wall is immobile, so it is never a promotion target.
 */
const fairyPieces = {
  wazir: {
    symbol: "w",
    betza: "W",
    promotionAbility: "priority",
    image: getPieceImageAsync("fantasy", "cyclops"),
    value: 2,
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
  wall: {
    symbol: "x",
    betza: "cK",
    promotionAbility: "deny",
    image: getPieceImageAsync("geometry", "square"),
    value: 1,
    behavior: wallBehavior,
  },
  unicorn: {
    symbol: "u",
    betza: "NN",
    image: getPieceImageAsync("fantasy", "unicorn"),
    value: 5,
    behavior: nightriderBehavior,
  },
  pylon: {
    symbol: "y",
    betza: "mQcfF",
    image: getPieceImageAsync("fantasy", "pylon"),
    value: 5,
    behavior: pylonBehavior,
  },
} satisfies Record<string, PieceType>;

export default fairyPieces;
