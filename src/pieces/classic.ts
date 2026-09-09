import type { PieceType } from "../chess-game";
import images from "../images";
import { jumpBehavior, moveBehavior, pawnBehavior, normalizeColor } from "./utils";

const classicPieces: Record<string, PieceType> = {
  pawn: {
    image: images.classic.pawn,
    behavior: normalizeColor(pawnBehavior),
  },
  rook: {
    image: images.classic.rook,
    behavior: moveBehavior([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 }
    ]),
  },
  knight: {
    image: images.classic.knight,
    behavior: jumpBehavior([
      { x: -2, y: -1 },
      { x: -2, y: 1 },
      { x: 2, y: -1 },
      { x: 2, y: 1 },
      { x: -1, y: -2 },
      { x: -1, y: 2 },
      { x: 1, y: -2 },
      { x: 1, y: 2 }
    ]),
  },
  bishop: {
    image: images.classic.bishop,
    behavior: moveBehavior([
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 }
    ]),
  },
  queen: {
    image: images.classic.queen,
    behavior: moveBehavior([
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]),
  },
  king: {
    image: images.classic.king,
    behavior: jumpBehavior([
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]),
  },
};

export default classicPieces;
