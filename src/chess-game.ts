import { type PieceImage } from "./images";
import classicPieces from "./pieces/classic";
import type { Behavior } from "./pieces/utils";

export type SpecialMovement = {
  to: Tile;
  type: "move" | "capture";
  promotion?: Promotion;
  castling?: Castle;
  passedTilesForEnPassant?: Tile[];
};

export type Promotion =
  | {
      state: "pending";
      options: PieceType[];
    }
  | {
      state: "resolved";
      piece: PieceType;
    };

export type Castle = {
  piece: Piece;
  destination: Tile;
};

export function movementHasPendingPromotion(
  m: SpecialMovement,
): m is SpecialMovement & { promotion: { state: "pending" } } {
  return m.promotion?.state === "pending";
}
export function movementHasNoPendingPromotion(
  m: SpecialMovement,
): m is SpecialMovement &
  ({ promotion: undefined } | { promotion: { state: "resolved" } }) {
  return !m.promotion || m.promotion.state === "resolved";
}

export interface PieceType {
  image: PieceImage;
  canEnPassant?: boolean;

  behavior: Behavior;
}

type Player =
  | {
      type: "human";
    }
  | {
      type: "ai";
      difficulty: number;
    };

export const pieceTypes = {
  ...classicPieces,
} satisfies Record<string, PieceType>;

export type Tile = {
  x: number;
  y: number;
};

export type Move = {
  from: Tile;
  to: Tile;
  piece: PieceType;
  color: "black" | "white";
};

export type Piece = {
  type: PieceType;
  color: "black" | "white";
  position: Tile;
  hasMoved: boolean;
};

function invertColor(color: "black" | "white"): "black" | "white" {
  return color === "black" ? "white" : "black";
}

export type TaggedMove = SpecialMovement & {
  piece: Piece;
  from: Tile;
};

export class ChessGame {
  pieces: Piece[] = [];
  moves: Move[] = [];
  turn: "black" | "white" = "white";
  halfTurnNumber: number = 0;
  canCastle: {
    white: boolean;
    black: boolean;
  } = Object.freeze({ white: false, black: false });
  players: {
    white: Player;
    black: Player;
  } = Object.freeze({ white: { type: "human" }, black: { type: "human" } });

  lastMove: TaggedMove | undefined = undefined;

  constructor() {
    this.canCastle = { ...this.canCastle };
  }

  getPieceAt(tile: Tile): Piece | undefined {
    return this.pieces.find(
      (piece) => piece.position.x === tile.x && piece.position.y === tile.y,
    );
  }

  isOccupied(tile: Tile): boolean {
    return this.getPieceAt(tile) !== undefined;
  }

  getValidMoves(piece: Piece): SpecialMovement[] {
    return piece.type.behavior(piece, this.pieces, this.lastMove);
  }

  /**
   * Does not check the validity of the move.
   * @param piece
   * @param tile
   * @param movePiece
   * @param destroyPiece
   */
  movePiece(
    piece: Piece,
    move: SpecialMovement &
      (
        | { promotion: undefined }
        | { promotion: { state: "resolved"; piece: PieceType } }
      ),
    movePiece: (piece: Piece, tile: Tile) => void,
    destroyPiece: (piece: Piece) => void,
    addPiece: (piece: Piece) => void,
  ): void {
    let previousPiecePosition = piece.position;

    let pieceAtTile =
      this.getPieceAt(move.to) ??
      (this.lastMove?.passedTilesForEnPassant?.find(
        (t) => t.x === move.to.x && t.y === move.to.y,
      ) &&
        this.getPieceAt(this.lastMove.to!));
    if (pieceAtTile) {
      this.pieces = this.pieces.filter((p) => p !== pieceAtTile);
      destroyPiece(pieceAtTile);
    }
    piece.position = move.to;
    piece.hasMoved = true;
    if (move.castling) {
      const rook = move.castling.piece;
      rook.position = move.castling.destination;
      rook.hasMoved = true;
      movePiece(rook, move.castling.destination);
    }
    movePiece(piece, move.to);

    if (move.promotion) {
      const promoted = { ...piece, type: move.promotion.piece };
      this.pieces = this.pieces.map((p) => (p === piece ? promoted : p));
      destroyPiece(piece);
      addPiece(promoted);
    }

    this.lastMove = { ...move, from: previousPiecePosition, piece };

    this.turn = invertColor(this.turn);
  }

  static defaultLayout(): ChessGame {
    const board = new ChessGame();
    const back = [
      pieceTypes.rook,
      pieceTypes.knight,
      pieceTypes.bishop,
      pieceTypes.queen,
      pieceTypes.king,
      pieceTypes.bishop,
      pieceTypes.knight,
      pieceTypes.rook,
    ];
    for (let x = 0; x < 8; x++) {
      board.pieces.push({
        type: pieceTypes.pawn,
        color: "white",
        position: { x, y: 1 },
        hasMoved: false,
      });
      board.pieces.push({
        type: pieceTypes.pawn,
        color: "black",
        position: { x, y: 6 },
        hasMoved: false,
      });
    }
    for (let x = 0; x < 8; x++) {
      board.pieces.push({
        type: back[x],
        color: "white",
        position: { x, y: 0 },
        hasMoved: false,
      });
      board.pieces.push({
        type: back[x],
        color: "black",
        position: { x, y: 7 },
        hasMoved: false,
      });
    }
    return board;
  }
}
