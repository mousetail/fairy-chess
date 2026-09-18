import {
  applyMove,
  getValidMoves,
  hasLegalMoves,
  isInCheck,
  type ChessBoardState,
  type Piece,
  type SpecialMovement,
  type TaggedMove,
} from "./chess-board.ts";
import type { Tile } from "./chess-tile.ts";
import pieceTypes, { type PieceType } from "./pieces/piece_types/index.ts";
import { Xoshiro128ss } from "./random.ts";
import {
  applyChaos,
  chaosLevels,
  type ChaosLevel,
} from "./replacement-rules.ts";

/**
 * Assigns each piece type a unique symbol, preferring its standard `symbol` and
 * otherwise the first free entry of its `fallbackSymbols`. Fairy-Stockfish only
 * supports one character per piece, so symbols are compared case-insensitively.
 */
export function resolveSymbols(
  types: Iterable<PieceType>,
): Map<PieceType, string> {
  const used = new Set<string>();
  const symbols = new Map<PieceType, string>();
  for (const type of types) {
    const candidates = [type.symbol, ...(type.fallbackSymbols ?? [])];
    const symbol =
      candidates.find((candidate) => !used.has(candidate.toLowerCase())) ??
      firstUnusedLetter(used);
    used.add(symbol.toLowerCase());
    symbols.set(type, symbol);
  }
  return symbols;
}

function firstUnusedLetter(used: Set<string>): string {
  for (let code = "a".charCodeAt(0); code <= "z".charCodeAt(0); code++) {
    const letter = String.fromCharCode(code);
    if (!used.has(letter)) return letter;
  }
  throw new Error("No unused piece symbol available");
}

export type AiEngine = "fairy-stockfish";

export type Player =
  | {
      type: "human";
    }
  | {
      type: "ai";
      engine: AiEngine;
      /** Difficulty from 0 (weakest) to 5 (strongest). */
      difficulty: number;
      /** Minimum time, in milliseconds, the AI waits before playing. */
      minTurnTimeMs: number;
    };

export type GameStatus = "checkmate" | "stalemate" | "repetition";

/**
 * What makes two positions the same for the repetition rule: every piece's kind,
 * side and square, whose turn it is, what may still be castled and whether a
 * pawn can be taken en passant. The move counters are left out, so a position
 * the game leaves and returns to always produces the same key again.
 */
function positionKey(state: ChessBoardState): string {
  const squares = state.pieces
    .map((piece) => {
      const symbol = state.symbols.get(piece.type) ?? piece.type.symbol;
      const color = piece.color === "white" ? "w" : "b";
      // Only a piece that could still be castled with makes its having moved part
      // of the position, as it does in chess: shuffling a knight out and back is
      // the same position, moving a king out and back is not.
      const moved =
        piece.type.canCastle || piece.type === pieceTypes.rook
          ? piece.hasMoved
            ? "-"
            : "+"
          : "";
      return `${symbol}${color}${piece.position.x}${piece.position.y}${moved}`;
    })
    .sort();
  const enPassant = state.lastMove?.passedTilesForEnPassant?.length ? "e" : "-";
  return `${state.turn}${enPassant}${squares.join("")}`;
}

export class ChessGame {
  state: ChessBoardState;
  players: {
    white: Player;
    black: Player;
  } = Object.freeze({ white: { type: "human" }, black: { type: "human" } });

  lastMove: TaggedMove | undefined = undefined;

  /**
   * How often each position has arisen, keyed as {@link positionKey} reads it.
   * The position the game is set up in counts as the first occurrence of
   * itself, so it is recorded with the first move rather than here: a game is
   * laid out by its pieces being placed, which the constructor cannot see.
   */
  private positionCounts: Map<string, number> | null = null;

  constructor() {
    this.state = {
      pieces: [],
      turn: "white",
      halfTurnNumber: 0,
      lastMove: undefined,
      symbols: new Map(),
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
    return getValidMoves(piece, this.state);
  }

  hasLegalMoves(color: "black" | "white"): boolean {
    return hasLegalMoves(color, this.state);
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
    onGameEnd: (status: GameStatus, color: "black" | "white") => void,
  ): void {
    // The position being left is the one the game was set up in the first time
    // round, so it is recorded before the move takes it away.
    this.positionCounts ??= new Map([[positionKey(this.state), 1]]);

    applyMove(this.state, move, movePiece, destroyPiece, addPiece);

    const key = positionKey(this.state);
    const occurrences = (this.positionCounts.get(key) ?? 0) + 1;
    this.positionCounts.set(key, occurrences);

    const color = this.state.turn;
    const inCheck = isInCheck(color, this.state);
    setInCheck(color, inCheck);

    if (!this.hasLegalMoves(color)) {
      onGameEnd(inCheck ? "checkmate" : "stalemate", color);
    } else if (occurrences >= 3) {
      // Seen three times over, the game is level; the side to move is not at
      // fault for it, but it is the side the position was reached with.
      onGameEnd("repetition", color);
    }
  }

  static defaultLayout(chaos: ChaosLevel = chaosLevels[0]): ChessGame {
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
    applyChaos(board.state, chaos, new Xoshiro128ss(Math.random() * 2**32, Math.random() * 2**32, Math.random() * 2**32, Math.random() * 2**32));
    board.state.symbols = resolveSymbols(
      new Set(board.state.pieces.map((piece) => piece.type))
    );
    return board;
  }
}
