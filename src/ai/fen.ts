import {
  movementHasNoPendingPromotion,
  movementHasPendingPromotion,
  pieceTypes,
  type ChessBoardState,
  type Piece,
  type SpecialMovement,
} from "../chess-board";
import type { ChessGame, PieceType } from "../chess-game";

const FILES = "abcdefgh";

export type ResolvedMove = {
  piece: Piece;
  move: SpecialMovement & {
    promotion: undefined | { state: "resolved"; piece: PieceType };
  };
};

function pieceToFenChar(piece: Piece): string {
  return piece.color === "white"
    ? piece.type.symbol.toUpperCase()
    : piece.type.symbol.toLowerCase();
}

/** Serialises the board into the standard FEN dialect understood by Fairy Stockfish. */
export function boardStateToFen(
  state: ChessBoardState,
  fullMoveNumber: number,
): string {
  const rows: string[] = [];
  for (let y = 7; y >= 0; y--) {
    let row = "";
    let empty = 0;
    for (let x = 0; x < 8; x++) {
      const piece = state.pieces.find(
        (candidate) => candidate.position.x === x && candidate.position.y === y,
      );
      if (!piece) {
        empty++;
        continue;
      }
      if (empty > 0) {
        row += empty;
        empty = 0;
      }
      row += pieceToFenChar(piece);
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }

  const castling = boardStateToCastlingRights(state);

  const enPassantTile = state.lastMove?.passedTilesForEnPassant?.[0];
  const enPassant = enPassantTile
    ? `${FILES[enPassantTile.x]}${enPassantTile.y + 1}`
    : "-";

  const activeColor = state.turn === "white" ? "w" : "b";
  const halfmove = Math.max(0, Math.floor(state.halfTurnNumber));
  return `${rows.join("/")} ${activeColor} ${castling} ${enPassant} ${halfmove} ${Math.max(1, fullMoveNumber)}`;
}

function boardStateToCastlingRights(state: ChessBoardState): string {
  let rights = "";
  for (const color of ["white", "black"] as const) {
    const backRank = color === "white" ? 0 : 7;
    const king = state.pieces.find(
      (piece) => piece.type === pieceTypes.king && piece.color === color,
    );
    if (!king || king.hasMoved) continue;

    const kingSideRook = state.pieces.find(
      (piece) =>
        piece.type === pieceTypes.rook &&
        piece.color === color &&
        piece.position.x === 7 &&
        piece.position.y === backRank,
    );
    const queenSideRook = state.pieces.find(
      (piece) =>
        piece.type === pieceTypes.rook &&
        piece.color === color &&
        piece.position.x === 0 &&
        piece.position.y === backRank,
    );

    if (kingSideRook && !kingSideRook.hasMoved) {
      rights += color === "white" ? "K" : "k";
    }
    if (queenSideRook && !queenSideRook.hasMoved) {
      rights += color === "white" ? "Q" : "q";
    }
  }
  return rights === "" ? "-" : rights;
}

/** Converts a UCI move (e.g. `e2e4`, `e7e8q`) into the game's own move representation. */
export function resolveUciMove(game: ChessGame, uci: string): ResolvedMove {
  const match = /^([a-h])([1-8])([a-h])([1-8])([qrbn])?$/i.exec(uci.trim());
  if (!match) {
    throw new Error(`Unsupported engine move: ${uci}`);
  }

  const from = {
    x: FILES.indexOf(match[1].toLowerCase()),
    y: Number(match[2]) - 1,
  };
  const to = {
    x: FILES.indexOf(match[3].toLowerCase()),
    y: Number(match[4]) - 1,
  };
  const promotionSymbol = match[5]?.toLowerCase() ?? "q";

  const piece = game.getPieceAt(from);
  if (!piece || piece.color !== game.state.turn) {
    throw new Error(`Engine move ${uci} does not match the current position`);
  }

  const move = game
    .getValidMoves(piece)
    .find((candidate) => candidate.to.x === to.x && candidate.to.y === to.y);
  if (!move) {
    throw new Error(`Engine move ${uci} is not legal`);
  }

  if (movementHasPendingPromotion(move)) {
    const promotionPiece =
      move.promotion.options.find(
        (option) => option.symbol.toLowerCase() === promotionSymbol,
      ) ?? move.promotion.options[0];
    return {
      piece,
      move: {
        ...move,
        promotion: { state: "resolved", piece: promotionPiece },
      },
    };
  }

  if (!movementHasNoPendingPromotion(move)) {
    throw new Error(`Engine move ${uci} has an unsupported promotion`);
  }

  return { piece, move };
}
