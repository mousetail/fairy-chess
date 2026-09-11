import type { PieceType } from "./chess-game";
import { tileToAlgebraic, type Tile } from "./chess-tile";
import classicPieces from "./pieces/classic";

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
    return "O-O";
  }
  const sameType = state.pieces.filter(
    (p) =>
      p.type === m.piece.type && p.color === m.piece.color && p !== m.piece,
  );
  const ambiguous = sameType.filter((p) =>
    p.type
      .behavior(p, state)
      .some((move) => move.to.x === m.to.x && move.to.y === m.to.y),
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
    promotion = "=" + m.promotion.piece.symbol.toLocaleUpperCase();
  }
  return `${m.piece.type === pieceTypes.pawn ? "" : m.piece.type.symbol.toLocaleUpperCase()}${disamb}${m.type === "capture" ? "x" : ""}${tileToAlgebraic(m.to)}${promotion}`;
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

export const pieceTypes = {
  ...classicPieces,
} satisfies Record<string, PieceType>;

export type Piece = {
  type: PieceType;
  color: "black" | "white";
  position: Tile;
  hasMoved: boolean;
  id: number;
};

function invertColor(color: "black" | "white"): "black" | "white" {
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
  const king = board.pieces.find(
    (p) => p.type === pieceTypes.king && p.color === color,
  );
  if (!king) return false;
  return board.pieces.some((enemy) => {
    if (enemy.color === king.color) return false;
    return enemy.type
      .behavior(enemy, board)
      .some(
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
