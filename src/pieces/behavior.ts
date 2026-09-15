import type { ChessBoardState, Piece, SpecialMovement } from "../chess-board.ts";
import type { Tile } from "../chess-tile.ts";
import { betzaBehavior, type Behavior } from "./betza.ts";
import pieceTypes, { type PieceType } from "./piece_types/index.ts";
import { getPromotionOptions } from "./promotion.ts";

const cache = new WeakMap<PieceType, Behavior>();

/**
 * The movement of a piece type, derived from its Betza notation and the rest of
 * its definition. The result is cached, since it is rebuilt from the notation
 * only once per piece type.
 */
export function getBehavior(type: PieceType): Behavior {
  let behavior = cache.get(type);
  if (!behavior) {
    behavior = buildBehavior(type);
    cache.set(type, behavior);
  }
  return behavior;
}

function buildBehavior(type: PieceType): Behavior {
  const base = betzaBehavior(type.betza, { enPassant: type.canEnPassant });
  const region = type.mobilityRegion
    ? {
        white: parseRegion(type.mobilityRegion.white),
        black: parseRegion(type.mobilityRegion.black),
      }
    : undefined;

  return (piece, state) => {
    let moves = base(piece, state);
    if (type.canEnPassant) moves = moves.concat(doubleStepMoves(piece, state));
    if (type.canCastle) moves = moves.concat(castlingMoves(piece, state));
    if (region) {
      const allowed = region[piece.color];
      moves = moves.filter((move) => allowed(move.to));
    }
    if (type.promotesLikePawn) moves = attachPromotion(moves, piece, state);
    return moves;
  };
}

function isOccupied(state: ChessBoardState, tile: Tile): boolean {
  return state.pieces.some(
    (piece) => piece.position.x === tile.x && piece.position.y === tile.y,
  );
}

/**
 * The two-square first move of a pawn-like piece. It may only be made from the
 * piece's starting rank, and marks the square it passed over so that an enemy
 * pawn may capture en passant.
 */
function doubleStepMoves(
  piece: Piece,
  state: ChessBoardState,
): SpecialMovement[] {
  const forward = piece.color === "white" ? 1 : -1;
  const startRank = piece.color === "white" ? 1 : 6;
  if (piece.position.y !== startRank) return [];
  const passed = { x: piece.position.x, y: piece.position.y + forward };
  const to = { x: piece.position.x, y: piece.position.y + 2 * forward };
  if (to.y < 0 || to.y > 7) return [];
  if (isOccupied(state, passed) || isOccupied(state, to)) return [];
  return [{ to, type: "move", passedTilesForEnPassant: [passed] }];
}

/**
 * The castling moves of a king-like piece: it may castle with an unmoved rook of
 * its own colour on the same rank, provided the squares between them are empty.
 */
function castlingMoves(
  piece: Piece,
  state: ChessBoardState,
): SpecialMovement[] {
  if (piece.hasMoved) return [];
  const moves: SpecialMovement[] = [];
  const row = piece.position.y;
  for (const direction of [-1, 1]) {
    let x = piece.position.x + direction;
    while (x >= 0 && x < 8) {
      const candidate = state.pieces.find(
        (other) => other.position.x === x && other.position.y === row,
      );
      if (
        candidate &&
        candidate.type === pieceTypes.rook &&
        candidate.color === piece.color &&
        !candidate.hasMoved
      ) {
        let clear = true;
        for (let between = piece.position.x + direction; between !== x; between += direction) {
          if (isOccupied(state, { x: between, y: row })) {
            clear = false;
            break;
          }
        }
        if (clear) {
          const kingSide = x > piece.position.x;
          moves.push({
            type: "move",
            to: { x: piece.position.x + (kingSide ? 2 : -2), y: row },
            castling: {
              piece: candidate,
              destination: { x: piece.position.x + (kingSide ? 1 : -1), y: row },
            },
          });
        }
        break;
      }
      if (candidate) break;
      x += direction;
    }
  }
  return moves;
}

/** Marks every move that lands on the far rank as a pending promotion. */
function attachPromotion(
  moves: SpecialMovement[],
  piece: Piece,
  state: ChessBoardState,
): SpecialMovement[] {
  const farRank = piece.color === "white" ? 7 : 0;
  const options = getPromotionOptions(state);
  return moves.map((move) =>
    move.to.y === farRank
      ? { ...move, promotion: { state: "pending", options } }
      : move,
  );
}

/**
 * Parses a movement area written in Fairy-Stockfish's bitboard syntax, where a
 * token is a square (`d4`), a whole rank (`*4`) or a whole file (`d*`).
 */
function parseRegion(syntax: string): (tile: Tile) => boolean {
  const files = new Set<number>();
  const ranks = new Set<number>();
  const squares = new Set<string>();
  let all = false;
  for (const token of syntax.trim().split(/\s+/).filter(Boolean)) {
    if (token === "*") {
      all = true;
    } else if (/^\*\d+$/.test(token)) {
      ranks.add(Number(token.slice(1)) - 1);
    } else if (/^[a-z]\*$/.test(token)) {
      files.add(token.charCodeAt(0) - "a".charCodeAt(0));
    } else if (/^[a-z]\d+$/.test(token)) {
      squares.add(token);
    }
  }
  return (tile) =>
    all ||
    squares.has(`${String.fromCharCode(97 + tile.x)}${tile.y + 1}`) ||
    files.has(tile.x) ||
    ranks.has(tile.y);
}
