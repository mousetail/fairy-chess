import { type ChessBoardState, type Piece } from "../../chess-board";
import pieceTypes, { type PieceType } from ".";
import {
  jumpBehavior,
  moveBehavior,
  pawnBehavior,
  normalizeColor,
  getPieceImageAsync,
} from "../utils";

const classicPieces = {
  pawn: {
    symbol: "p",
    betza: "fmWfceF",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("classic", "pawn"),
    behavior: normalizeColor(pawnBehavior),
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
    behavior: moveBehavior([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ]),
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
    behavior: jumpBehavior([
      { x: -2, y: -1 },
      { x: -2, y: 1 },
      { x: 2, y: -1 },
      { x: 2, y: 1 },
      { x: -1, y: -2 },
      { x: -1, y: 2 },
      { x: 1, y: -2 },
      { x: 1, y: 2 },
    ]),
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
    behavior: moveBehavior([
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]),
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
    symbol: "k",
    betza: "K",
    promotionAbility: "deny",
    image: getPieceImageAsync("classic", "king"),
    value: 0,
    displayName: "King",
    description: "Moves one square in any direction; may castle.",
    diagram: {
      size: 5,
      rows: [".....", ".xxx.", ".xox.", ".xxx.", "....."],
    },
    behavior: (piece: Piece, state: ChessBoardState) => {
      const board = state.pieces;
      const moves = jumpBehavior([
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
        { x: 1, y: 1 },
        { x: 1, y: -1 },
        { x: -1, y: 1 },
        { x: -1, y: -1 },
      ])(piece, state);
      if (piece.hasMoved) return moves;
      const row = piece.position.y;
      const color = piece.color;
      for (const dir of [-1, 1]) {
        let x = piece.position.x + dir;
        while (x >= 0 && x < 8) {
          const p = board.find(
            (b) => b.position.x === x && b.position.y === row,
          );
          if (
            p &&
            p.type === pieceTypes.rook &&
            p.color === color &&
            !p.hasMoved
          ) {
            // check empty between
            let clear = true;
            for (let cx = piece.position.x + dir; cx !== x; cx += dir) {
              if (
                board.find((b) => b.position.x === cx && b.position.y === row)
              ) {
                clear = false;
                break;
              }
            }
            if (clear) {
              moves.push({
                type: "move",
                to: {
                  x:
                    x > piece.position.x
                      ? piece.position.x + 2
                      : piece.position.x - 2,
                  y: row,
                },
                castling: {
                  piece: p,
                  destination: {
                    x:
                      x > piece.position.x
                        ? piece.position.x + 1
                        : piece.position.x - 1,
                    y: row,
                  },
                },
              });
            }
            break;
          }
          if (p) break;
          x += dir;
        }
      }

      return moves;
    },
  },
} satisfies Record<string, PieceType>;

export default classicPieces;
