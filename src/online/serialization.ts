import type {
  ChessBoardState,
  Piece,
  TaggedMove,
} from "../chess-board.ts";
import type { Tile } from "../chess-tile.ts";
import pieceTypes, { type PieceType } from "../pieces/piece_types/index.ts";

/**
 * Converts a game state to and from plain JSON, so it can be sent over a
 * WebSocket.
 *
 * Piece types are identified by their key in {@link pieceTypes} rather than by
 * object identity, because a JSON document cannot reference the piece type
 * objects the game is built from. The symbol map travels with the board so both
 * ends agree on the letters used in the move log.
 */

/** Maps each piece type back to its key in {@link pieceTypes}. */
const keysByType = new Map<PieceType, string>(
  Object.entries(pieceTypes).map(([key, type]) => [type, key]),
);

/** The key identifying `type` in the piece registry. Throws when unregistered. */
export function pieceTypeKey(type: PieceType): string {
  const key = keysByType.get(type);
  if (key === undefined) {
    throw new Error(`Unregistered piece type: ${type.displayName}`);
  }
  return key;
}

/** The piece type registered under `key`. Throws when the key is unknown. */
export function pieceTypeFromKey(key: string): PieceType {
  const type = pieceTypes[key];
  if (type === undefined) {
    throw new Error(`Unknown piece type key: ${key}`);
  }
  return type;
}

export interface SerializedPiece {
  id: number;
  /** The piece type's key in the piece registry. */
  type: string;
  color: "white" | "black";
  position: Tile;
  hasMoved: boolean;
}

/**
 * A played move. It carries the square the piece came from, so the receiving
 * end can highlight it and rebuild a full {@link TaggedMove} against the board
 * it already has.
 */
export interface SerializedMove {
  pieceId: number;
  /** The type the moving piece had before the move was applied. */
  piece: string;
  from: Tile;
  to: Tile;
  type: "move" | "capture";
  /** The piece type promoted to, for a move that reaches the far rank. */
  promotion?: string;
  castling?: { pieceId: number; destination: Tile };
  passedTilesForEnPassant?: Tile[];
}

export interface SerializedBoardState {
  pieces: SerializedPiece[];
  turn: "white" | "black";
  halfTurnNumber: number;
  /** The symbol in play for each piece type, keyed by the piece type's key. */
  symbols: Record<string, string>;
  lastMove?: SerializedMove;
}

/**
 * The symbol in play for each piece type, keyed by the piece type's key.
 *
 * This is the alias map: a board has more piece types than the alphabet has
 * letters, so a position and its move list can only be read back with the
 * symbols they were written with.
 */
export function serializeSymbols(
  state: ChessBoardState,
): Record<string, string> {
  const symbols: Record<string, string> = {};
  for (const [type, symbol] of state.symbols) {
    symbols[pieceTypeKey(type)] = symbol;
  }
  return symbols;
}

export function serializeBoardState(
  state: ChessBoardState,
): SerializedBoardState {
  const serialized: SerializedBoardState = {
    pieces: state.pieces.map((piece) => ({
      id: piece.id,
      type: pieceTypeKey(piece.type),
      color: piece.color,
      position: { ...piece.position },
      hasMoved: piece.hasMoved,
    })),
    turn: state.turn,
    halfTurnNumber: state.halfTurnNumber,
    symbols: serializeSymbols(state),
  };

  if (state.lastMove) serialized.lastMove = serializeMove(state.lastMove);
  return serialized;
}

export function serializeMove(move: TaggedMove): SerializedMove {
  const serialized: SerializedMove = {
    pieceId: move.piece.id,
    piece: pieceTypeKey(move.piece.type),
    from: { ...move.from },
    to: { ...move.to },
    type: move.type,
  };
  if (move.promotion?.state === "resolved") {
    serialized.promotion = pieceTypeKey(move.promotion.piece);
  }
  if (move.castling) {
    serialized.castling = {
      pieceId: move.castling.piece.id,
      destination: { ...move.castling.destination },
    };
  }
  if (move.passedTilesForEnPassant) {
    serialized.passedTilesForEnPassant = move.passedTilesForEnPassant.map(
      (tile) => ({ ...tile }),
    );
  }
  return serialized;
}

export function deserializeBoardState(
  serialized: SerializedBoardState,
): ChessBoardState {
  const pieces: Piece[] = serialized.pieces.map((piece) => ({
    id: piece.id,
    type: pieceTypeFromKey(piece.type),
    color: piece.color,
    position: { x: piece.position.x, y: piece.position.y },
    hasMoved: piece.hasMoved,
  }));

  const symbols = new Map<PieceType, string>();
  for (const [key, symbol] of Object.entries(serialized.symbols)) {
    symbols.set(pieceTypeFromKey(key), symbol);
  }

  const state: ChessBoardState = {
    pieces,
    turn: serialized.turn,
    halfTurnNumber: serialized.halfTurnNumber,
    lastMove: undefined,
    symbols,
  };
  if (serialized.lastMove) {
    state.lastMove = deserializeMove(serialized.lastMove, state);
  }
  return state;
}

/**
 * Rebuilds a move against `state`, which must hold the piece the move belongs
 * to. Returns undefined when that piece is missing, so a caller can simply drop
 * a move it can no longer place.
 */
export function deserializeMove(
  serialized: SerializedMove,
  state: ChessBoardState,
): TaggedMove | undefined {
  const piece = state.pieces.find(
    (candidate) => candidate.id === serialized.pieceId,
  );
  if (!piece) return undefined;

  const move: TaggedMove = {
    piece,
    from: { x: serialized.from.x, y: serialized.from.y },
    to: { x: serialized.to.x, y: serialized.to.y },
    type: serialized.type,
  };
  if (serialized.promotion) {
    move.promotion = {
      state: "resolved",
      piece: pieceTypeFromKey(serialized.promotion),
    };
  }
  if (serialized.castling) {
    const rook = state.pieces.find(
      (candidate) => candidate.id === serialized.castling!.pieceId,
    );
    if (rook) {
      move.castling = {
        piece: rook,
        destination: {
          x: serialized.castling.destination.x,
          y: serialized.castling.destination.y,
        },
      };
    }
  }
  if (serialized.passedTilesForEnPassant) {
    move.passedTilesForEnPassant = serialized.passedTilesForEnPassant.map(
      (tile) => ({ x: tile.x, y: tile.y }),
    );
  }
  return move;
}
