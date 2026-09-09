import { type PieceImage } from "./images";
import classicPieces from "./pieces/classic";
import type { Behavior } from "./pieces/utils";

export type SpecialMovement = {
  tile: Tile;
  type: "move" | "capture";
  isPromotion?: boolean;
  passedTilesForEnPassant?: Tile[];
};

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

export const pieces: Record<string, PieceType> = {
  ...classicPieces,
};

export type Tile = {
  x: number;
  y: number;
};

function isTile(t: Tile | SpecialMovement): t is Tile {
  return Object.hasOwn(t, "x") && Object.hasOwn(t, "y");
}

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
};

function invert(tile: Tile): Tile {
  return { x: 7 - tile.x, y: 7 - tile.y };
}

function invertColor(color: "black" | "white"): "black" | "white" {
  return color === "black" ? "white" : "black";
}

export type TaggedMove = {
  move: SpecialMovement;
  moveType: "move" | "capture";
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

  lastMoveFrom: Tile | undefined;
  lastMoveTo: Tile | undefined;
  lastMoveEnPassant: Tile[] | undefined;

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
    return piece.type.behavior(piece, this.pieces)
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
    move: SpecialMovement,
    movePiece: (piece: Piece, tile: Tile) => void,
    destroyPiece: (piece: Piece) => void,
  ): void {
    const oldPiecePosition = piece.position;

    let pieceAtTile =
      this.getPieceAt(move.tile) ??
      (this.lastMoveEnPassant?.find((t) => t.x === move.tile.x && t.y === move.tile.y) && this.getPieceAt(this.lastMoveTo!));
    if (pieceAtTile) {
      this.pieces = this.pieces.filter((p) => p !== pieceAtTile);
      destroyPiece(pieceAtTile);
    }
    piece.position = move.tile;
    movePiece(piece, move.tile);

    this.lastMoveFrom = oldPiecePosition;
    this.lastMoveTo = move.tile;
    this.lastMoveEnPassant = move.passedTilesForEnPassant;

    this.turn = invertColor(this.turn);
  }

  static defaultLayout(): ChessGame {
    const board = new ChessGame();
    const back = [
      pieces.rook,
      pieces.knight,
      pieces.bishop,
      pieces.queen,
      pieces.king,
      pieces.bishop,
      pieces.knight,
      pieces.rook,
    ];
    for (let x = 0; x < 8; x++) {
      board.pieces.push({
        type: pieces.pawn,
        color: "white",
        position: { x, y: 1 },
      });
      board.pieces.push({
        type: pieces.pawn,
        color: "black",
        position: { x, y: 6 },
      });
    }
    for (let x = 0; x < 8; x++) {
      board.pieces.push({
        type: back[x],
        color: "white",
        position: { x, y: 0 },
      });
      board.pieces.push({
        type: back[x],
        color: "black",
        position: { x, y: 7 },
      });
    }
    return board;
  }
}
