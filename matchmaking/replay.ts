import {
  type ChessBoardState,
  movementHasPendingPromotion,
  type Piece,
  type SpecialMovement,
  specialMovementToPgn,
  type TaggedMove,
} from "../src/chess-board.ts";
import { ChessGame } from "../src/chess-game.ts";
import type { GameHistory, SerializedPlay } from "../src/online/protocol.ts";
import {
  pieceTypeFromKey,
  serializeBoardState,
  serializeMove,
} from "../src/online/serialization.ts";
import type { PieceType } from "../src/pieces/piece_types/index.ts";
import type { LoggedMove } from "./pgn.ts";

/**
 * Reading a game back from the pieces it is stored as.
 *
 * A finished game is kept as a PGN move list and the position it started from,
 * with the alias map that names the pieces in both. To show the game again — or
 * to hand a reconnecting client its move log — the moves have to be played back
 * onto that position. Each move is matched against the legal moves of the side
 * to move by its algebraic notation, which is what the same code wrote when the
 * move was first played, so the match is exact.
 */

/** A movement with no promotion left to resolve. */
type ResolvedMovement =
  & SpecialMovement
  & ({ promotion: undefined } | {
    promotion: { state: "resolved"; piece: PieceType };
  });

const ignore = () => {};

/**
 * The position a FEN describes.
 *
 * Only a position a game was laid out in is read, which is what the stored FEN
 * always is: nothing has moved, white is to move, and there is no en passant
 * square. Castling rights are not read either, since they say whether a king
 * and rook are still where they started rather than whether they ever moved,
 * and in a layout that has just been set up they have not.
 */
export function fenToBoardState(
  fen: string,
  symbols: Record<string, string>,
): ChessBoardState {
  const parts = fen.split(/\s+/).filter(Boolean);
  const placement = parts[0];
  const activeColor = parts[1] ?? "w";
  const enPassant = parts[3] ?? "-";

  if (enPassant !== "-") {
    throw new Error(`A FEN with en passant cannot be read: ${fen}`);
  }

  const symbolMap = new Map<PieceType, string>();
  const typeBySymbol = new Map<string, PieceType>();
  for (const [key, symbol] of Object.entries(symbols)) {
    const type = pieceTypeFromKey(key);
    symbolMap.set(type, symbol);
    typeBySymbol.set(symbol.toLowerCase(), type);
  }

  const rows = placement.split("/");
  if (rows.length !== 8) throw new Error(`A FEN needs eight ranks: ${fen}`);

  const pieces: Piece[] = [];
  let id = 0;
  rows.forEach((row, index) => {
    const y = 7 - index;
    let x = 0;
    for (const letter of row) {
      const empty = Number(letter);
      if (Number.isInteger(empty) && empty >= 1 && empty <= 8) {
        x += empty;
        continue;
      }
      const type = typeBySymbol.get(letter.toLowerCase());
      if (!type) {
        throw new Error(`A FEN names a piece no alias covers: ${letter}`);
      }
      if (x > 7) throw new Error(`A FEN rank is too wide: ${row}`);
      pieces.push({
        id: id++,
        type,
        color: letter === letter.toUpperCase() ? "white" : "black",
        position: { x, y },
        hasMoved: false,
      });
      x++;
    }
    if (x !== 8) throw new Error(`A FEN rank is too narrow: ${row}`);
  });

  return {
    pieces,
    turn: activeColor === "b" ? "black" : "white",
    halfTurnNumber: 0,
    lastMove: undefined,
    symbols: symbolMap,
  };
}

/**
 * Plays `moves` back onto the position `initialFen` describes.
 *
 * Returns the opening position as a client needs it, and every move with the
 * board's own terms for it, so the client can apply them without repeating the
 * matching. Throws when a move of the list cannot be found, which means the
 * record and the rules have drifted apart.
 */
export function replayGame(
  initialFen: string,
  symbols: Record<string, string>,
  moves: LoggedMove[],
): GameHistory {
  const game = new ChessGame();
  game.state = fenToBoardState(initialFen, symbols);
  const initialBoard = serializeBoardState(game.state);

  const plays: SerializedPlay[] = [];
  for (const move of moves) {
    const tagged = matchMove(game, move.pgn);
    game.movePiece(tagged, ignore, ignore, ignore, ignore, ignore);
    plays.push({
      color: move.color,
      pgn: move.pgn,
      move: serializeMove(tagged),
    });
  }
  return { initialBoard, moves: plays };
}

/** The one legal move of the side to move that is written as `pgn`. */
function matchMove(game: ChessGame, pgn: string): TaggedMove {
  const state = game.state;
  const matches: TaggedMove[] = [];
  for (const piece of state.pieces) {
    if (piece.color !== state.turn) continue;
    for (const movement of game.getValidMoves(piece)) {
      for (const resolved of resolvePromotion(movement)) {
        const tagged: TaggedMove = {
          ...resolved,
          from: { x: piece.position.x, y: piece.position.y },
          piece,
        };
        if (specialMovementToPgn(tagged, state) === pgn) matches.push(tagged);
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`No legal move is written ${pgn}`);
  }
  if (matches.length > 1) {
    throw new Error(`More than one legal move is written ${pgn}`);
  }
  return matches[0];
}

/** The movements a move to the far rank stands for, one for each piece it may become. */
function resolvePromotion(movement: SpecialMovement): ResolvedMovement[] {
  if (!movementHasPendingPromotion(movement)) {
    return [movement as ResolvedMovement];
  }
  return movement.promotion.options.map((piece) => ({
    ...movement,
    promotion: { state: "resolved" as const, piece },
  }));
}
