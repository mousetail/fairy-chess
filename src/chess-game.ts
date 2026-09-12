import {
  applyMove,
  isInCheck,
  pieceTypes,
  simulateMove,
  type ChessBoardState,
  type Piece,
  type SpecialMovement,
  type TaggedMove,
} from "./chess-board";
import type { Tile } from "./chess-tile";
import type { Behavior, LazyImage } from "./pieces/utils";

export interface PieceType {
  image: LazyImage;
  canEnPassant?: boolean;

  behavior: Behavior;
  symbol: string;
}

type Player =
  | {
      type: "human";
    }
  | {
      type: "ai";
      difficulty: number;
    };

export class ChessGame {
  state: ChessBoardState;
  players: {
    white: Player;
    black: Player;
  } = Object.freeze({ white: { type: "human" }, black: { type: "human" } });

  lastMove: TaggedMove | undefined = undefined;

  constructor() {
    this.state = {
      pieces: [],
      turn: "white",
      halfTurnNumber: 0,
      lastMove: undefined,
    };
  }

  getPieceAt(tile: Tile): Piece | undefined {
    return this.state.pieces.find(
      (piece) => piece.position.x === tile.x && piece.position.y === tile.y,
    );
  }

  isOccupied(tile: Tile): boolean {
    return this.getPieceAt(tile) !== undefined;
  }

  getValidMoves(piece: Piece): SpecialMovement[] {
    const moves = piece.type.behavior(piece, this.state);
    return moves.filter((move) => {
      let moveWithPromotion = {
        ...move,
        piece,
        from: piece.position,
        promotion: undefined,
      };

      const simulated = simulateMove(this.state, moveWithPromotion);
      return !isInCheck(piece.color, simulated);
    });
  }

  /**
   * Does not check the validity of the move.
   * @param piece
   * @param tile
   * @param movePiece
   * @param destroyPiece
   */
  movePiece(
    move: TaggedMove,
    movePiece: (piece: number, tile: Tile) => void,
    destroyPiece: (piece: number) => void,
    addPiece: (piece: Piece) => void,
    setInCheck: (color: "black" | "white", isInCheck: boolean) => void,
  ): void {
    applyMove(this.state, move, movePiece, destroyPiece, addPiece);

    setInCheck(this.state.turn, isInCheck(this.state.turn, this.state))
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
      board.state.pieces.push({
        type: pieceTypes.pawn,
        color: "white",
        position: { x, y: 1 },
        hasMoved: false,
        id: x,
      });
      board.state.pieces.push({
        type: pieceTypes.pawn,
        color: "black",
        position: { x, y: 6 },
        hasMoved: false,
        id: x + 8,
      });
    }
    for (let x = 0; x < 8; x++) {
      board.state.pieces.push({
        type: back[x],
        color: "white",
        position: { x, y: 0 },
        hasMoved: false,
        id: x + 16,
      });
      board.state.pieces.push({
        type: back[x],
        color: "black",
        position: { x, y: 7 },
        hasMoved: false,
        id: x + 24,
      });
    }
    return board;
  }
}
