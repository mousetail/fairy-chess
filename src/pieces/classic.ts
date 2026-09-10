import {
  pieceTypes,
  type Piece,
  type PieceType,
  type TaggedMove,
} from "../chess-game";
import images from "../images";
import {
  jumpBehavior,
  moveBehavior,
  pawnBehavior,
  normalizeColor,
} from "./utils";

const classicPieces = {
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
      { x: 0, y: 1 },
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
      { x: 1, y: 2 },
    ]),
  },
  bishop: {
    image: images.classic.bishop,
    behavior: moveBehavior([
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
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
    behavior: (
      piece: Piece,
      board: Piece[],
      lastMove: TaggedMove | undefined,
    ) => {
      const moves = jumpBehavior([
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
        { x: 1, y: 1 },
        { x: 1, y: -1 },
        { x: -1, y: 1 },
        { x: -1, y: -1 },
      ])(piece, board, lastMove);
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
