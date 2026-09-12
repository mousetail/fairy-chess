import { pieceTypes, type ChessBoardState, type Piece } from "../chess-board";
import { type PieceType } from "../chess-game";
import {
  jumpBehavior,
  moveBehavior,
  pawnBehavior,
  normalizeColor,
  getPieceImageAsync,
} from "./utils";

const classicPieces = {
  pawn: {
    symbol: "p",
    image: getPieceImageAsync("classic", "pawn"),
    behavior: normalizeColor(pawnBehavior),
  },
  rook: {
    symbol: "r",
    image: getPieceImageAsync("classic", "rook"),
    behavior: moveBehavior([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ]),
  },
  knight: {
    symbol: "n",
    image: getPieceImageAsync("classic", "knight"),
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
    image: getPieceImageAsync("classic", "bishop"),
    behavior: moveBehavior([
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]),
  },
  queen: {
    symbol: "q",
    image: getPieceImageAsync("classic", "queen"),
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
    image: getPieceImageAsync("classic", "king"),
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
