import { tileToAlgebraic, type Tile } from "./chess-tile.ts";
import { getBehavior } from "./pieces/behavior.ts";
import type { PieceType } from "./pieces/piece_types/index.ts";
import pieceTypes from "./pieces/piece_types/index.ts";

export type SpecialMovement = {
  to: Tile;
  type: "move" | "capture";
  promotion?: Promotion;
  castling?: Castle;
  passedTilesForEnPassant?: Tile[];
};

export function specialMovementToPgn(
  m: TaggedMove,
  state: ChessBoardState,
): string {
  if (m.castling) {
    // The side matters: without it a PGN cannot say which rook the king went
    // to, and the move cannot be played back.
    return m.to.x > m.from.x ? "O-O" : "O-O-O";
  }
  const symbolOf = (type: PieceType) => state.symbols.get(type) ?? type.symbol;
  const sameType = state.pieces.filter(
    (p) =>
      p.type === m.piece.type && p.color === m.piece.color && p !== m.piece,
  );
  const ambiguous = sameType.filter((p) =>
    getBehavior(p.type)(p, state).some(
      (move) => move.to.x === m.to.x && move.to.y === m.to.y,
    ),
  );
  let disamb = "";
  if (ambiguous.length > 0) {
    const fileAmbiguous = ambiguous.some((p) => p.position.x === m.from.x);
    const rankAmbiguous = ambiguous.some((p) => p.position.y === m.from.y);
    if (!fileAmbiguous) disamb += tileToAlgebraic(m.from).charAt(0);
    else if (!rankAmbiguous) disamb += tileToAlgebraic(m.from).charAt(1);
    else disamb += tileToAlgebraic(m.from);
  }
  let promotion = "";
  if (m.promotion) {
    promotion = "=" + symbolOf(m.promotion.piece).toLocaleUpperCase();
  }
  return `${m.piece.type === pieceTypes.pawn ? "" : symbolOf(m.piece.type).toLocaleUpperCase()}${disamb}${m.type === "capture" ? "x" : ""}${tileToAlgebraic(m.to)}${promotion}`;
}

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

export type Piece = {
  type: PieceType;
  color: "black" | "white";
  position: Tile;
  hasMoved: boolean;
  id: number;
};

export function invertColor(color: "black" | "white"): "black" | "white" {
  return color === "black" ? "white" : "black";
}

export type TaggedMove = SpecialMovement & {
  promotion?: undefined | (Promotion & { state: "resolved" });
  piece: Piece;
  from: Tile;
};

export type ChessBoardState = {
  pieces: Piece[];
  turn: "black" | "white";
  halfTurnNumber: number;
  lastMove: TaggedMove | undefined;
  /**
   * The symbol used for each piece type in play. Fixed when the game is set up
   * so that pieces sharing a standard symbol get distinct fallbacks.
   */
  symbols: Map<PieceType, string>;
};

function getPieceAt(state: ChessBoardState, tile: Tile): Piece | undefined {
  return state.pieces.find(
    (p) => p.position.x === tile.x && p.position.y === tile.y,
  );
}

export function cloneChessBoardState(state: ChessBoardState): ChessBoardState {
  return {
    ...state,
    pieces: state.pieces.map((i) => ({ ...i })),
  };
}

export function isInCheck(
  color: "black" | "white",
  board: ChessBoardState,
): boolean {
  const king = board.pieces.find((p) => p.type.royal && p.color === color);
  if (!king) return false;
  return board.pieces.some((enemy) => {
    if (enemy.color === king.color) return false;
    return getBehavior(enemy.type)(enemy, board).some(
      (m) =>
        m.type === "capture" &&
        m.to.x === king.position.x &&
        m.to.y === king.position.y,
    );
  });
}

export function simulateMove(
  state: ChessBoardState,
  move: TaggedMove,
): ChessBoardState {
  const newState = cloneChessBoardState(state);
  applyMove(
    newState,
    move,
    () => {},
    () => {},
    () => {},
  );
  return newState;
}

/** Returns the moves of a piece that would not leave its own king in check. */
export function getValidMoves(
  piece: Piece,
  board: ChessBoardState,
): SpecialMovement[] {
  const moves = getBehavior(piece.type)(piece, board);
  return moves.filter((move) => {
    const moveWithPromotion = {
      ...move,
      piece,
      from: piece.position,
      promotion: undefined,
    };

    const simulated = simulateMove(board, moveWithPromotion);
    if (isInCheck(piece.color, simulated)) return false;

    // A king may not castle out of, or through, check either.
    if (move.castling) {
      if (isInCheck(piece.color, board)) return false;
      const between = {
        x: (piece.position.x + move.to.x) / 2,
        y: piece.position.y,
      };
      const passed = simulateMove(board, {
        ...moveWithPromotion,
        to: between,
        castling: undefined,
      });
      if (isInCheck(piece.color, passed)) return false;
    }

    return true;
  });
}

/** Whether the given color has at least one legal move in this position. */
export function hasLegalMoves(
  color: "black" | "white",
  board: ChessBoardState,
): boolean {
  return board.pieces
    .filter((piece) => piece.color === color)
    .some((piece) => getValidMoves(piece, board).length > 0);
}

export function applyMove(
  state: ChessBoardState,
  move: TaggedMove,
  movePiece: (id: number, tile: Tile) => void,
  destroyPiece: (piece: number) => void,
  addPiece: (piece: Piece) => void,
) {
  let piece = state.pieces.find((p) => p.id === move.piece.id)!;
  let previousPiecePosition = piece.position;

  let pieceAtTile =
    getPieceAt(state, move.to) ??
    (state.lastMove?.passedTilesForEnPassant?.find(
      (t) => t.x === move.to.x && t.y === move.to.y,
    ) &&
      getPieceAt(state, state.lastMove.to!));
  if (pieceAtTile) {
    state.pieces = state.pieces.filter((p) => p !== pieceAtTile);
    destroyPiece(pieceAtTile.id);
  }
  piece.position = move.to;
  piece.hasMoved = true;
  const castling = move.castling;
  if (castling !== undefined) {
    const rook = state.pieces.find((p) => p.id === castling.piece.id)!;
    rook.position = castling.destination;
    rook.hasMoved = true;
    movePiece(rook.id, castling.destination);
  }
  movePiece(piece.id, move.to);

  if (move.promotion) {
    const promoted = { ...piece, type: move.promotion.piece };
    state.pieces = state.pieces.map((p) => (p.id === piece.id ? promoted : p));
    destroyPiece(piece.id);
    addPiece(promoted);
  }

  state.lastMove = { ...move, from: previousPiecePosition, piece };

  state.turn = invertColor(state.turn);
}
