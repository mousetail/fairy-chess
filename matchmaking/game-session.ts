import {
  invertColor,
  movementHasNoPendingPromotion,
  type Piece,
  type SpecialMovement,
  specialMovementToPgn,
  type TaggedMove,
} from "../src/chess-board.ts";
import { ChessGame, type GameStatus } from "../src/chess-game.ts";
import {
  pieceTypeFromKey,
  pieceTypeKey,
  serializeBoardState,
  type SerializedBoardState,
} from "../src/online/serialization.ts";
import type {
  Color,
  GameResult,
  MoveRejection,
  MoveRequest,
} from "../src/online/protocol.ts";
import { chaosLevels } from "../src/replacement-rules.ts";
import type { PieceType } from "../src/pieces/piece_types/index.ts";

/**
 * A move as a client asks for it, before the server has checked it. The shape
 * lives with the rest of the protocol, so the browser and the server cannot
 * disagree about it.
 */
export type { MoveRequest };

/** A move the server accepted, with everything the clients need to follow it. */
export interface AppliedMove {
  color: Color;
  move: TaggedMove;
  pgn: string;
  board: SerializedBoardState;
  /** Whether the side that must move next is in check. */
  inCheck: boolean;
}

export type MoveOutcome =
  | { ok: true; applied: AppliedMove; result?: GameResult }
  | { ok: false; rejection: MoveRejection };

/** A movement that has no promotion left to resolve. */
type ResolvedMovement =
  & SpecialMovement
  & ({ promotion: undefined } | {
    promotion: { state: "resolved"; piece: PieceType };
  });

type ChosenMovement =
  | { movement: ResolvedMovement }
  | { rejection: MoveRejection };

/**
 * One game between two players, as the server sees it.
 *
 * The session is the authority on the position: it lays out the starting
 * position for the chaos level it was created with and refuses any move that
 * does not match one its own move generation produces.
 */
export class GameSession {
  /** The index into `chaosLevels` this game is played at. */
  readonly complexity: number;
  readonly game: ChessGame;
  private result: GameResult | null = null;

  constructor(complexity: number) {
    this.complexity = complexity;
    this.game = ChessGame.defaultLayout(chaosLevels[complexity]);
  }

  get colorToMove(): Color {
    return this.game.state.turn;
  }

  /** The result once the game is over, and `null` while it is still running. */
  get finished(): GameResult | null {
    return this.result;
  }

  /** The current position, ready to send to a client. */
  serializeBoard(): SerializedBoardState {
    return serializeBoardState(this.game.state);
  }

  /**
   * Checks `request` against the position and, when it is legal, plays it.
   *
   * `color` is the side asking, which is only ever the side the server knows
   * sent the message; a client cannot move for its opponent.
   */
  play(color: Color, request: MoveRequest): MoveOutcome {
    if (this.result) return refuse({ reason: "game-over" });

    const state = this.game.state;
    if (state.turn !== color) return refuse({ reason: "not-your-turn" });

    const piece = state.pieces.find(
      (candidate) => candidate.id === request.pieceId,
    );
    if (!piece) return refuse({ reason: "unknown-piece" });
    if (piece.color !== color) return refuse({ reason: "not-your-piece" });
    if (
      piece.position.x !== request.from.x ||
      piece.position.y !== request.from.y
    ) {
      return refuse({ reason: "stale-position" });
    }

    const candidates = this.game
      .getValidMoves(piece)
      .filter((move) =>
        move.to.x === request.to.x && move.to.y === request.to.y
      );
    if (candidates.length === 0) return refuse({ reason: "illegal-move" });

    const chosen = chooseMovement(candidates, request.promotion);
    if ("rejection" in chosen) return refuse(chosen.rejection);

    return this.apply(color, piece, chosen.movement);
  }

  /** Ends the game, awarding the win to `color`'s opponent. */
  resign(color: Color): GameResult {
    const result: GameResult = { status: "resign", winner: invertColor(color) };
    this.result = result;
    return result;
  }

  /** Ends the game level, because both players agreed to it. */
  draw(): GameResult {
    const result: GameResult = { status: "draw", winner: "draw" };
    this.result = result;
    return result;
  }

  private apply(
    color: Color,
    piece: Piece,
    movement: ResolvedMovement,
  ): MoveOutcome {
    const taggedMove: TaggedMove = {
      ...movement,
      from: piece.position,
      piece,
    };
    const pgn = specialMovementToPgn(taggedMove, this.game.state);

    let inCheck = false;
    let endStatus: GameStatus | undefined;
    let matedColor: Color | undefined;
    this.game.movePiece(
      taggedMove,
      () => {},
      () => {},
      () => {},
      (_color, value) => {
        inCheck = value;
      },
      (status, endColor) => {
        endStatus = status;
        matedColor = endColor;
      },
    );

    if (endStatus !== undefined && matedColor !== undefined) {
      this.result = endStatus === "checkmate"
        ? { status: "checkmate", winner: invertColor(matedColor) }
        : { status: "stalemate", winner: "draw" };
    }

    return {
      ok: true,
      applied: {
        color,
        move: taggedMove,
        pgn,
        board: this.serializeBoard(),
        inCheck,
      },
      result: this.result ?? undefined,
    };
  }
}

function refuse(rejection: MoveRejection): MoveOutcome {
  return { ok: false, rejection };
}

/**
 * Picks the one movement the client asked for out of every move to the same
 * square.
 *
 * Reaching the far rank produces several movements that differ only in what
 * they promote to, so the client's choice decides between them. A move that
 * needs a promotion but arrives without one is refused with the options, so the
 * client can ask the player.
 */
function chooseMovement(
  candidates: SpecialMovement[],
  promotionKey: string | undefined,
): ChosenMovement {
  if (promotionKey !== undefined) {
    let promotion: PieceType;
    try {
      promotion = pieceTypeFromKey(promotionKey);
    } catch {
      return { rejection: { reason: "illegal-move" } };
    }
    const match = candidates.find(
      (move) =>
        move.promotion?.state === "pending" &&
        move.promotion.options.includes(promotion),
    );
    if (!match) return { rejection: { reason: "illegal-move" } };
    return {
      movement: {
        ...match,
        promotion: { state: "resolved", piece: promotion },
      },
    };
  }

  const match = candidates.find(movementHasNoPendingPromotion);
  if (match) return { movement: match };

  const pending = candidates[0].promotion;
  return {
    rejection: {
      reason: "promotion-required",
      options: pending?.state === "pending"
        ? pending.options.map(pieceTypeKey)
        : [],
    },
  };
}
