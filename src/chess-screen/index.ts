import {
  cloneChessBoardState,
  hasLegalMoves,
  invertColor,
  isInCheck,
  movementHasNoPendingPromotion,
  movementHasPendingPromotion,
  specialMovementToPgn,
  type ChessBoardState,
  type Piece,
  type SpecialMovement,
} from "../chess-board.ts";
import { ChessGame, type GameStatus, type Player } from "../chess-game.ts";
import type { Tile } from "../chess-tile.ts";
import { recordGame, type GameOutcome } from "../discoveries.ts";
import { HistoryBar } from "../history-bar.ts";
import { PieceInfoBar } from "../piece-info-bar.ts";
import { chaosLevels } from "../replacement-rules.ts";
import type { Screen } from "../screen.ts";
import { AiPlayer } from "../ai/ai-player.ts";
import type { Color, MoveRejection, MoveRequest } from "../online/protocol.ts";
import {
  deserializeBoardState,
  pieceTypeFromKey,
  pieceTypeKey,
  type SerializedBoardState,
} from "../online/serialization.ts";
import { ArrowsLayer } from "./arrows-layer.ts";
import { BoardView } from "./board-view.ts";
import { tileFromEvent } from "./board-geometry.ts";
import { getImageFromPromise } from "./piece-images.ts";
import { PieceDragController } from "./piece-drag-controller.ts";
import { createPromotionDialogue } from "./promotion-dialogue.ts";
import type { PieceType } from "../pieces/piece_types/index.ts";

/** The pieces `mine` has that `theirs` does not, ordered from least to most valuable. */
function surplusPieces(mine: Piece[], theirs: Piece[]): PieceType[] {
  const counts = new Map<PieceType, number>();
  for (const piece of theirs) {
    counts.set(piece.type, (counts.get(piece.type) ?? 0) + 1);
  }
  const surplus: PieceType[] = [];
  for (const piece of mine) {
    const remaining = counts.get(piece.type) ?? 0;
    if (remaining > 0) {
      counts.set(piece.type, remaining - 1);
    } else {
      surplus.push(piece.type);
    }
  }
  return surplus.sort((a, b) => a.value - b.value);
}

/** The piece type `key` names, or nothing when this build does not know it. */
function knownPieceType(key: string): PieceType[] {
  try {
    return [pieceTypeFromKey(key)];
  } catch {
    return [];
  }
}

/** A player-facing explanation of a move the server refused. */
function rejectionText(rejection: MoveRejection): string {
  switch (rejection.reason) {
    case "game-over":
      return "The game is already over.";
    case "not-your-turn":
      return "It is not your turn yet.";
    case "unknown-piece":
    case "not-your-piece":
      return "The server does not have that piece on your side.";
    case "stale-position":
      return "Your board was out of date; try the move again.";
    case "illegal-move":
      return "The server did not allow that move.";
    case "promotion-required":
      return "The server needs to know what to promote to.";
  }
}

export interface ChessScreenOptions {
  white?: Player;
  black?: Player;
  /** Index into {@link chaosLevels} describing how many fairy pieces to add. */
  chaosLevel?: number;
  /**
   * The position to start from, when someone other than this screen laid it
   * out. An online game uses the one the server sent; {@link chaosLevel} then
   * only describes how the server chose it.
   */
  initialBoard?: SerializedBoardState;
  /** Names to show in the player bars, instead of the ones the players imply. */
  playerNames?: Partial<Record<Color, string>>;
  /** Set when the game is played against someone over the network. */
  online?: OnlineOpponent;
  /**
   * The name of the level the game is played at, shown while it lasts. Only a
   * game the server laid out has one: a local game uses the level the player
   * picked, which the home screen has already shown them.
   */
  levelLabel?: string;
  onPlayAgain?: () => void;
}

/** What an online game needs that the screen cannot work out for itself. */
export interface OnlineOpponent {
  /** The colour this browser plays. */
  color: Color;
  /** Asks the server to play a move; the board changes when it accepts. */
  requestMove(request: MoveRequest): void;
  /** Asks the server to end the game in the opponent's favour. */
  resign(): void;
  /** Offers a draw, which the game is drawn on once the opponent offers too. */
  offerDraw(): void;
}

/**
 * How a game ended. The local rules only ever reach the first two; only the
 * server can call a game on a resignation or an agreed draw.
 */
export type GameEndStatus = GameStatus | "resign" | "draw";

interface PlayerBar {
  element: HTMLDivElement;
  clock: HTMLDivElement;
  advantage: HTMLDivElement;
}

export default class ChessScreen implements Screen {
  game: ChessGame;
  boardView: BoardView;
  arrowsLayer: ArrowsLayer;
  dragController: PieceDragController;
  movesLog: HTMLDivElement;
  historyBar: HistoryBar | null = null;
  pieceInfoBar: PieceInfoBar;

  selectedPiece: { piece: Piece; moves: SpecialMovement[] } | null = null;
  /**
   * The position the board is currently showing. While the history is being
   * browsed this is a past snapshot, so inspecting pieces must read it rather
   * than the live game state.
   */
  visibleState: ChessBoardState;
  /**
   * The piece selected when the pointer last went down, used to tell a click on
   * an already-selected piece apart from the selection the drag controller makes
   * on pointerdown.
   */
  private pointerDownSelectionId: number | null = null;
  handlingPromotion: boolean = false;
  gameEnded: boolean = false;
  scoreWidget: HTMLDivElement;
  scoreDisplay: HTMLDivElement;
  playAgainButton: HTMLButtonElement;
  blackPlayerBar: PlayerBar;
  whitePlayerBar: PlayerBar;

  private options: ChessScreenOptions;
  private aiPlayer: AiPlayer | null = null;
  private aiThinking = false;
  private aiError: string | null = null;
  private disposed = false;
  private plyCount = 0;
  /** The names shown in the player bars, and logged with a finished game. */
  private readonly playerNames: Record<Color, string>;
  /** The opponent this browser is playing over the network, when there is one. */
  private readonly online: OnlineOpponent | undefined;
  /** The move this browser last asked the server to play, if any. */
  private onlineRequest: { piece: Piece; move: SpecialMovement } | null = null;
  /** Where a short message for the player is shown, once the screen is up. */
  private noticeElement: HTMLParagraphElement | null = null;
  private resignButton: HTMLButtonElement | null = null;
  private drawButton: HTMLButtonElement | null = null;
  /** The row holding the resign and draw buttons, once the screen is up. */
  private gameActions: HTMLDivElement | null = null;
  /**
   * The draw offers standing: this browser's, the opponent's, or neither. A
   * move clears them, as it does on the server.
   */
  private drawOffer: "none" | "mine" | "theirs" = "none";
  /**
   * The piece types the game was set up with. A finished game credits every one
   * of them, whichever player ended up with it.
   */
  private readonly piecesInPlay: PieceType[];

  constructor(options: ChessScreenOptions = {}) {
    this.options = options;
    this.online = options.online;

    if (options.initialBoard) {
      // Someone else laid the position out — in an online game, the server.
      this.game = new ChessGame();
      this.game.state = deserializeBoardState(options.initialBoard);
    } else {
      const chaos = chaosLevels[options.chaosLevel ?? 0] ?? chaosLevels[0];
      this.game = ChessGame.defaultLayout(chaos);
    }
    this.visibleState = this.game.state;
    this.piecesInPlay = [
      ...new Set(this.game.state.pieces.map((piece) => piece.type)),
    ];
    this.game.players = {
      white: options.white ?? { type: "human" },
      black: options.black ?? { type: "human" },
    };
    this.playerNames = {
      white: options.playerNames?.white ??
        this.playerLabel(this.game.players.white),
      black: options.playerNames?.black ??
        this.playerLabel(this.game.players.black),
    };

    const aiConfig = [this.game.players.white, this.game.players.black].find(
      (player) => player.type === "ai",
    );
    if (aiConfig?.type === "ai") {
      this.aiPlayer = new AiPlayer({
        minTurnTimeMs: aiConfig.minTurnTimeMs,
        difficulty: aiConfig.difficulty,
      });
      this.aiPlayer.onError((message) => {
        this.aiError = message;
        console.error("Fairy Stockfish failed to start:", message);
        alert(`Fairy Stockfish failed to start: ${message}`);
      });
    }

    this.boardView = new BoardView({
      onTileClick: (tile) => this.clickTile(tile),
      onPointerDown: (event) => this.onBoardPointerDown(event),
    });
    // Playing black shows the board from black's side, so the pieces this
    // browser commands are the ones nearest the bottom of the screen.
    if (this.online?.color === "black") {
      this.boardView.element.classList.add("black");
    }
    this.arrowsLayer = new ArrowsLayer(this.boardView.element);
    this.dragController = new PieceDragController(this.boardView.element, {
      getPieceImage: (id) => this.boardView.getPieceImage(id),
      getSelection: () => this.selectedPiece,
      selectPiece: (piece) => this.selectPiece(piece),
      performMove: (piece, move) => this.performMove(piece, move),
      clearSelection: () => this.clearSelection(),
      setDragHighlight: (tile) => this.boardView.setDragHighlight(tile),
    });

    this.movesLog = document.createElement("div");
    this.pieceInfoBar = new PieceInfoBar();

    this.scoreWidget = document.createElement("div");
    this.scoreWidget.classList.add("score-widget", "hidden");
    this.scoreDisplay = document.createElement("div");
    this.scoreDisplay.classList.add("score");
    this.scoreWidget.appendChild(this.scoreDisplay);
    this.playAgainButton = document.createElement("button");
    this.playAgainButton.classList.add("play-again-button");
    this.playAgainButton.textContent = "Play again";
    this.scoreWidget.appendChild(this.playAgainButton);

    this.blackPlayerBar = this.createPlayerBar(this.playerNames.black);
    this.whitePlayerBar = this.createPlayerBar(this.playerNames.white);
    this.updateMaterialAdvantage(this.game.state);
    this.updateTurnIndicator();
  }

  activate(parent: HTMLElement): void {
    parent.replaceChildren();

    const leftColumn = document.createElement("div");
    leftColumn.classList.add("left-column");
    // Seen from black's side the player bars swap over, so the bar belonging to
    // the side at the bottom of the screen sits below the board too.
    if (this.online?.color === "black") {
      leftColumn.classList.add("black");
    }
    parent.appendChild(leftColumn);

    this.boardView.clearPieces();
    leftColumn.appendChild(this.blackPlayerBar.element);
    leftColumn.appendChild(this.boardView.element);
    leftColumn.appendChild(this.whitePlayerBar.element);
    this.boardView.setArrowsLayer(this.arrowsLayer.element);
    for (const piece of this.game.state.pieces) {
      this.boardView.addPiece(piece);
    }

    const sidebar = document.createElement("div");
    sidebar.classList.add("sidebar");
    parent.appendChild(sidebar);

    this.noticeElement = document.createElement("p");
    this.noticeElement.classList.add("game-notice");
    this.noticeElement.hidden = true;
    sidebar.appendChild(this.noticeElement);

    if (this.options.levelLabel) {
      const level = document.createElement("p");
      level.classList.add("game-level");
      level.textContent = `Playing at: ${this.options.levelLabel}`;
      sidebar.appendChild(level);
    }

    sidebar.appendChild(this.scoreWidget);
    sidebar.appendChild(this.pieceInfoBar.element);
    this.playAgainButton.addEventListener("click", () => {
      this.deactivate();
      if (this.options.onPlayAgain) {
        this.options.onPlayAgain();
      } else {
        new ChessScreen(this.options).activate(parent);
      }
    });

    if (this.online) {
      const actions = document.createElement("div");
      actions.classList.add("game-actions");
      this.gameActions = actions;

      const draw = document.createElement("button");
      draw.classList.add("draw-button");
      draw.textContent = "Offer draw";
      draw.addEventListener("click", () => {
        if (draw.disabled) return;
        // The same message covers offering and accepting: the server draws the
        // game once both sides have offered.
        this.drawOffer = "mine";
        this.renderDrawButton();
        this.online?.offerDraw();
      });
      this.drawButton = draw;
      actions.appendChild(draw);

      const resign = document.createElement("button");
      resign.classList.add("resign-button");
      resign.textContent = "Resign";
      // Resigning asks twice: one click arms the button, the next gives up.
      resign.addEventListener("click", () => {
        if (!resign.classList.contains("confirming")) {
          resign.classList.add("confirming");
          resign.textContent = "Confirm resign";
          return;
        }
        resign.disabled = true;
        this.online?.resign();
      });
      this.resignButton = resign;
      actions.appendChild(resign);
    }

    this.historyBar = new HistoryBar(
      sidebar,
      (state) => {
        this.visibleState = state;
        this.clearSelection();
        this.boardView.clearPieces();
        for (const piece of state.pieces) {
          this.boardView.addPiece(piece);
        }
        if (state.lastMove) {
          this.boardView.setHighlightedMoves(state.lastMove);
        }
        this.updateCheckMarkers(state);
        this.updateMaterialAdvantage(state);
      },
      () => !this.handlingPromotion,
    );

    // Below the move log, so it is out of the way of the game itself.
    if (this.gameActions) sidebar.appendChild(this.gameActions);

    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("pointerdown", this.onDocumentPointerDown);

    this.aiPlayer?.preload();
    this.maybeRunAi();
  }

  clearSelection(): void {
    this.boardView.clearMovePips();
    this.selectedPiece = null;
  }

  onBoardPointerDown(event: PointerEvent): void {
    if (event.button === 2) {
      this.arrowsLayer.beginArrow(event);
    } else if (event.button === 0) {
      this.pointerDownSelectionId = this.selectedPiece?.piece.id ?? null;
      this.startPieceDrag(event);
    }
  }

  canInteract(): boolean {
    return !this.gameEnded && this.historyBar?.isAtPresent() === true;
  }

  /**
   * Whether a piece may be picked up: it belongs to a side this browser
   * controls, and it is that side's turn to move.
   */
  private playable(piece: Piece): boolean {
    if (piece.color !== this.game.state.turn) return false;
    if (this.game.players[piece.color].type !== "human") return false;
    // Over the network the opponent is a person too, so only the side the
    // server gave this browser may be moved.
    return this.online === undefined || this.online.color === piece.color;
  }

  /** The piece occupying a tile in the position the board is showing. */
  private pieceAt(tile: Tile): Piece | undefined {
    return this.visibleState.pieces.find(
      (piece) => piece.position.x === tile.x && piece.position.y === tile.y,
    );
  }

  clickTile(tile: Tile): void {
    if (this.handlingPromotion) return;

    // Inspecting works while the history is being browsed or the engine is
    // thinking, but neither allows actually playing a move. The history shows a
    // past position, so read the piece from what is on display.
    if (!this.canInteract() || this.aiThinking) {
      const inspected = this.pieceAt(tile);
      if (inspected) this.pieceInfoBar.show(inspected.type);
      if (!this.canInteract()) this.clearSelection();
      return;
    }

    const piece = this.game.getPieceAt(tile);

    // A legal destination of the selected piece completes the move, taking
    // priority over inspecting whatever occupies the tile.
    if (this.selectedPiece !== null) {
      const move = this.selectedPiece.moves.find(
        (move) => move.to.x === tile.x && move.to.y === tile.y,
      );
      if (move) {
        this.performMove(this.selectedPiece.piece, move);
        return;
      }
    }

    if (piece) {
      this.pieceInfoBar.show(piece.type);
    }

    // Clicking the already-selected piece again deselects it; anything else
    // (an enemy piece, or an empty square) also drops the selection.
    if (piece !== undefined && this.playable(piece) &&
      this.pointerDownSelectionId !== piece.id
    ) {
      this.selectPiece(piece);
    } else {
      this.clearSelection();
    }
  }

  /** Applies a move, deferring to the promotion dialogue when necessary. */
  performMove(piece: Piece, move: SpecialMovement): void {
    if (movementHasPendingPromotion(move)) {
      this.showPromotionOptions(piece, move);
      this.clearSelection();
    } else if (movementHasNoPendingPromotion(move)) {
      this.resolveMove(piece, move);
    } else {
      throw new Error("Unreachable!");
    }
  }

  startPieceDrag(event: PointerEvent): void {
    if (this.handlingPromotion || this.aiThinking || !this.canInteract())
      return;

    const tile = tileFromEvent(this.boardView.element, event);
    if (!tile) return;

    const piece = this.game.getPieceAt(tile);
    if (!piece || !this.playable(piece)) {
      return;
    }

    this.dragController.start(event, piece);
  }

  resolveMove(
    piece: Piece,
    move: SpecialMovement &
      ({ promotion: undefined } | { promotion: { state: "resolved" } }),
  ): void {
    if (!this.canInteract()) return;

    if (this.online) {
      // The server referees, so this asks rather than plays: the board changes
      // when it answers with the position the move produced.
      this.onlineRequest = { piece, move };
      this.online.requestMove({
        pieceId: piece.id,
        from: { ...piece.position },
        to: { ...move.to },
        promotion: move.promotion?.state === "resolved"
          ? pieceTypeKey(move.promotion.piece)
          : undefined,
      });
      this.arrowsLayer.clear();
      this.clearSelection();
      return;
    }

    const taggedMove = { ...move, from: piece.position, piece };
    const pgn = specialMovementToPgn(taggedMove, this.game.state);
    this.game.movePiece(
      taggedMove,
      this.boardView.movePiece.bind(this.boardView),
      this.boardView.destroyPiece.bind(this.boardView),
      this.boardView.addPiece.bind(this.boardView),
      this.setInCheck.bind(this),
      this.setGameEnd.bind(this),
    );
    this.boardView.setHighlightedMoves(taggedMove);
    this.visibleState = this.game.state;

    this.historyBar!.addLogEntry(cloneChessBoardState(this.game.state), pgn);
    this.arrowsLayer.clear();
    this.clearSelection();
    this.plyCount++;
    this.updateTurnIndicator();
    this.updateMaterialAdvantage(this.game.state);
    this.maybeRunAi();
  }

  showPromotionOptions(
    piece: Piece,
    move: SpecialMovement & { promotion: { state: "pending" } },
  ): void {
    this.handlingPromotion = true;
    createPromotionDialogue(this.boardView.element, piece, move, (option) => {
      this.handlingPromotion = false;
      this.resolveMove(piece, {
        ...move,
        promotion: { state: "resolved", piece: option },
      });
    });
  }

  setInCheck(color: Color, isInCheck: boolean): void {
    if (!isInCheck) {
      this.boardView.setCheckMarker(null);
      return;
    }
    const king = this.game.state.pieces.find(
      (i) => i.type.royal && i.color === color,
    );
    this.boardView.setCheckMarker(king ? king.position : null);
  }

  setGameEnd(status: GameEndStatus, color: Color): void {
    if (this.gameEnded) return;
    this.gameEnded = true;
    this.clearSelection();
    this.disarmResign();
    if (this.resignButton) this.resignButton.disabled = true;
    if (this.drawButton) this.drawButton.disabled = true;
    if (status === "checkmate") {
      const king = this.game.state.pieces.find(
        (piece) => piece.type.royal && piece.color === color,
      );
      this.boardView.setCheckmatedKing(king ? king.id : null);
    }
    this.scoreWidget.classList.remove("hidden");
    if (status === "stalemate" || status === "draw") {
      this.scoreDisplay.textContent = "½-½";
    } else {
      this.scoreDisplay.textContent = color === "white" ? "0-1" : "1-0";
    }
    this.recordDiscovery(status, color);
  }

  /**
   * Shows the result the server decided. `winner` is the side that won, or
   * `"draw"`; the rest of the screen only needs the side that lost.
   */
  declareResult(status: GameEndStatus, winner: Color | "draw"): void {
    this.setGameEnd(status, winner === "draw" ? "white" : invertColor(winner));
  }

  /**
   * Replaces the position with the one the server sent after it accepted a
   * move.
   *
   * The server is the authority, so the board is replaced rather than advanced:
   * the opponent's moves arrive the same way, and a move this browser asked for
   * has not happened until it comes back here.
   */
  applyServerMove(
    board: SerializedBoardState,
    pgn: string,
    inCheck: boolean,
  ): void {
    const state = deserializeBoardState(board);
    this.game.state = state;
    this.visibleState = state;
    this.onlineRequest = null;

    // The pieces are brought over rather than replaced, so the one that moved
    // slides to its new square instead of appearing there.
    this.boardView.syncPieces(state.pieces);
    if (state.lastMove) {
      this.boardView.setHighlightedMoves(state.lastMove);
    }
    // A move is a fresh start for both buttons, as it is for the offers on the
    // server.
    this.disarmResign();
    this.clearDrawOffer();
    this.updateCheckMarkers(state, inCheck);
    this.arrowsLayer.clear();
    this.clearSelection();
    this.updateMaterialAdvantage(state);
    this.updateTurnIndicator();

    this.historyBar?.addLogEntry(cloneChessBoardState(state), pgn);
    this.plyCount++;
  }

  /**
   * Reports a move the server would not accept. Nothing has to be undone: the
   * board only ever shows positions the server has sent.
   */
  reportRejection(rejection: MoveRejection): void {
    if (rejection.reason === "promotion-required") {
      const request = this.onlineRequest;
      const options = rejection.options.flatMap(knownPieceType);
      if (request && options.length > 0) {
        this.showPromotionOptions(request.piece, {
          ...request.move,
          promotion: { state: "pending", options },
        });
        return;
      }
      this.showNotice("The server did not say what to promote to.");
    } else {
      // A refused move never happened, so the piece is put back where the
      // server says it is; a drag may have left it on the square it was
      // dropped on.
      this.boardView.syncPieces(this.game.state.pieces);
      this.showNotice(rejectionText(rejection));
    }
    this.onlineRequest = null;
  }

  /**
   * Reports that the opponent offered a draw, which this browser takes as a
   * chance to accept. A move clears the offer again, so nothing is said about
   * it beyond the button changing.
   */
  reportDrawOffer(color: Color): void {
    // An offer this browser made is answered by the opponent's, which ends the
    // game, and its own offer comes back echoed, so neither needs acting on.
    if (color === this.online?.color || this.drawOffer === "mine") return;
    this.drawOffer = "theirs";
    this.renderDrawButton();
  }

  /** Shows what the draw button would do, given the offers standing. */
  private renderDrawButton(): void {
    const button = this.drawButton;
    if (!button) return;
    button.disabled = this.drawOffer === "mine";
    button.textContent = this.drawOffer === "mine"
      ? "Draw offered"
      : this.drawOffer === "theirs"
      ? "Accept draw"
      : "Offer draw";
  }

  /**
   * Puts a draw offer back in the players' hands, which a move does on the
   * server as well.
   */
  private clearDrawOffer(): void {
    if (this.drawOffer === "none") return;
    this.drawOffer = "none";
    this.renderDrawButton();
  }

  /** Shows a short message in the sidebar, for what the game cannot say. */
  showNotice(text: string): void {
    if (!this.noticeElement) return;
    this.noticeElement.textContent = text;
    this.noticeElement.hidden = false;
  }

  /** Takes a resign button that is waiting for confirmation back to its start. */
  private disarmResign(): void {
    const button = this.resignButton;
    if (!button || !button.classList.contains("confirming")) return;
    button.classList.remove("confirming");
    button.textContent = "Resign";
  }

  /**
   * Credits the finished game to the local player's discoveries. The local
   * player is the colour this browser plays: the one the server handed out in
   * an online game, and white otherwise, since white is the side a person has
   * in both of the local modes.
   */
  private recordDiscovery(status: GameEndStatus, color: Color): void {
    const playerColor: Color = this.online?.color ??
      (this.game.players.white.type === "human" ? "white" : "black");
    const outcome: GameOutcome = status === "stalemate" || status === "draw"
      ? "tie"
      : color === playerColor
      ? "loss"
      : "win";
    recordGame({
      pieces: this.piecesInPlay,
      outcome,
      opponentName: this.playerNames[invertColor(playerColor)],
    });
  }

  selectPiece(piece: Piece): void {
    if (this.playable(piece)) {
      this.clearSelection();
      const moves = this.game.getValidMoves(piece);
      this.selectedPiece = { piece, moves };
      this.boardView.showMovePips(moves);
      this.pieceInfoBar.show(piece.type);
    }
  }

  deactivate(): void {
    this.disposed = true;
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    this.aiPlayer?.dispose();
    this.aiPlayer = null;
  }

  /** Updates the check marker and checkmate orientation to match a state. */
  private updateCheckMarkers(
    state: ChessBoardState,
    inCheck: boolean = isInCheck(state.turn, state),
  ): void {
    const color = state.turn;
    const king = state.pieces.find(
      (piece) => piece.type.royal && piece.color === color,
    );
    const checkmated = inCheck && !hasLegalMoves(color, state);
    this.boardView.setCheckMarker(inCheck && king ? king.position : null);
    this.boardView.setCheckmatedKing(checkmated && king ? king.id : null);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.historyBar?.historyBack();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.historyBar?.historyForward();
    }
  };

  /**
   * Clicking anywhere off the board drops the movement selection, and puts an
   * armed resign button back, so confirming a resignation always takes two
   * clicks on the button itself. The sidebar is left alone, so the last
   * inspected piece stays on display.
   */
  private onDocumentPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.handlingPromotion) return;
    const target = event.target as Node | null;
    if (!this.resignButton?.contains(target)) this.disarmResign();
    if (target && this.boardView.element.contains(target)) return;
    this.clearSelection();
  };

  private maybeRunAi(): void {
    if (!this.aiPlayer || this.gameEnded || this.disposed) return;
    if (this.aiError) {
      console.warn(
        `AI will not move because the engine previously failed: ${this.aiError}`,
      );
      return;
    }
    if (!this.historyBar?.isAtPresent()) return;
    const turn = this.game.state.turn;
    if (this.game.players[turn].type !== "ai") return;
    void this.runAiMove();
  }

  private async runAiMove(): Promise<void> {
    const aiPlayer = this.aiPlayer;
    if (!aiPlayer || this.aiThinking) return;

    this.aiThinking = true;
    try {
      const { piece, move } = await aiPlayer.chooseMove(
        this.game,
        Math.floor(this.plyCount / 2) + 1,
      );
      if (this.disposed || this.gameEnded) return;
      if (this.game.state.turn !== piece.color) return;
      this.resolveMove(piece, move);
    } catch (error) {
      if (this.disposed) return;
      this.aiError = error instanceof Error ? error.message : String(error);
      console.error("Fairy Stockfish failed to play a move:", error);
      alert(`Fairy Stockfish failed: ${this.aiError}`);
    } finally {
      this.aiThinking = false;
    }
  }

  private createPlayerBar(name: string): PlayerBar {
    const element = document.createElement("div");
    element.classList.add("player-bar");

    const info = document.createElement("div");
    info.classList.add("player-info");

    const nameElement = document.createElement("div");
    nameElement.classList.add("player-name");
    nameElement.textContent = name;

    const advantage = document.createElement("div");
    advantage.classList.add("player-advantage");

    info.appendChild(nameElement);
    info.appendChild(advantage);

    const clock = document.createElement("div");
    clock.classList.add("player-clock");
    clock.textContent = "--:--";

    element.appendChild(info);
    element.appendChild(clock);
    return { element, clock, advantage };
  }

  /** Shows each player's material surplus and, for the leader, the point lead. */
  private updateMaterialAdvantage(state: ChessBoardState): void {
    const white = state.pieces.filter((piece) => piece.color === "white");
    const black = state.pieces.filter((piece) => piece.color === "black");
    const whiteValue = white.reduce((sum, p) => sum + p.type.value, 0);
    const blackValue = black.reduce((sum, p) => sum + p.type.value, 0);
    const difference = whiteValue - blackValue;

    this.renderPlayerAdvantage(
      this.whitePlayerBar,
      surplusPieces(white, black),
      "white",
      Math.max(difference, 0),
    );
    this.renderPlayerAdvantage(
      this.blackPlayerBar,
      surplusPieces(black, white),
      "black",
      Math.max(-difference, 0),
    );
  }

  private renderPlayerAdvantage(
    bar: PlayerBar,
    pieces: PieceType[],
    color: "black" | "white",
    valueDifference: number,
  ): void {
    bar.advantage.replaceChildren();
    for (const type of pieces) {
      const icon = getImageFromPromise(
        type.image,
        color === "white" ? "black" : "white",
      );
      icon.classList.add("advantage-piece");
      bar.advantage.appendChild(icon);
    }
    if (valueDifference > 0) {
      const value = document.createElement("span");
      value.classList.add("advantage-value");
      value.textContent = `(+${valueDifference})`;
      bar.advantage.appendChild(value);
    }
  }

  private playerLabel(player: Player): string {
    if (player.type === "human") return "Human";
    const name =
      player.engine === "fairy-stockfish" ? "Fairy Stockfish" : player.engine;
    return `${name} (difficulty ${player.difficulty})`;
  }

  private updateTurnIndicator(): void {
    const turn = this.game.state.turn;
    this.blackPlayerBar.clock.classList.toggle("active", turn === "black");
    this.whitePlayerBar.clock.classList.toggle("active", turn === "white");
  }
}
