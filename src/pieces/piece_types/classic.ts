import { type PieceType } from "./index.ts";
import { getPieceImageAsync } from "../utils.ts";

const classicPieces = {
  pawn: {
    symbol: "p",
    betza: "fmWfceF",
    promotionAbility: "deny",
    promotesLikePawn: true,
    canEnPassant: true,
    image: getPieceImageAsync("classic", "pawn"),
    value: 1,
    displayName: "Pawn",
    description: "Moves 1 or 2 squares forward; captures diagonally.",
    diagram: {
      size: 5,
      rows: ["..x..", ".cxc.", "..o..", ".....", "....."],
    },
  },
  rook: {
    symbol: "r",
    betza: "R",
    image: getPieceImageAsync("classic", "rook"),
    value: 5,
    displayName: "Rook",
    description: "Slides any number of squares horizontally or vertically.",
    diagram: {
      size: 5,
      rows: ["..x..", "..x..", "xxoxx", "..x..", "..x.."],
    },
  },
  knight: {
    symbol: "n",
    betza: "N",
    image: getPieceImageAsync("classic", "knight"),
    value: 3,
    displayName: "Knight",
    description: "Leaps in an L shape, jumping over other pieces.",
    diagram: {
      size: 5,
      rows: [".x.x.", "x...x", "..o..", "x...x", ".x.x."],
    },
  },
  bishop: {
    symbol: "b",
    betza: "B",
    image: getPieceImageAsync("classic", "bishop"),
    value: 3,
    displayName: "Bishop",
    description: "Slides any number of squares diagonally.",
    diagram: {
      size: 5,
      rows: ["x...x", ".x.x.", "..o..", ".x.x.", "x...x"],
    },
  },
  queen: {
    symbol: "q",
    betza: "Q",
    image: getPieceImageAsync("classic", "queen"),
    value: 9,
    displayName: "Queen",
    description: "Slides any number of squares in any direction.",
    diagram: {
      size: 5,
      rows: ["x.x.x", ".xxx.", "xxoxx", ".xxx.", "x.x.x"],
    },
  },
  king: {
    symbol: "k",
    betza: "K",
    royal: true,
    promotionAbility: "deny",
    canCastle: true,
    image: getPieceImageAsync("classic", "king"),
    value: 0,
    displayName: "King",
    description: "Moves one square in any direction; may castle.",
    diagram: {
      size: 5,
      rows: [".....", ".xxx.", ".xox.", ".xxx.", "....."],
    },
  },
} satisfies Record<string, PieceType>;

export default classicPieces;
