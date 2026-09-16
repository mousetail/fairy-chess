import {
  cloneChessBoardState,
  hasLegalMoves,
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
import { HistoryBar } from "../history-bar.ts";
import { PieceInfoBar } from "../piece-info-bar.ts";
import { chaosLevels } from "../replacement-rules.ts";
import type { Screen } from "../screen.ts";
import { AiPlayer } from "../ai/ai-player.ts";
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

export interface ChessScreenOptions {
  white?: Player;
  black?: Player;
  /** Index into {@link chaosLevels} describing how many fairy pieces to add. */
  chaosLevel?: number;
  onPlayAgain?: () => void;
}

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

  constructor(options: ChessScreenOptions = {}) {
    this.options = options;
    const chaos = chaosLevels[options.chaosLevel ?? 0] ?? chaosLevels[0];
    this.game = ChessGame.defaultLayout(chaos);
    this.visibleState = this.game.state;
    this.game.players = {
      white: options.white ?? { type: "human" },
      black: options.black ?? { type: "human" },
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

    this.blackPlayerBar = this.createPlayerBar(
      this.playerLabel(this.game.players.black),
    );
    this.whitePlayerBar = this.createPlayerBar(
      this.playerLabel(this.game.players.white),
    );
    this.updateMaterialAdvantage(this.game.state);
    this.updateTurnIndicator();
  }

  activate(parent: HTMLElement): void {
    parent.replaceChildren();

    const leftColumn = document.createElement("div");
    leftColumn.classList.add("left-column");
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

    const ownHumanPiece =
      piece !== undefined &&
      piece.color === this.game.state.turn &&
      this.game.players[piece.color].type === "human";

    // Clicking the already-selected piece again deselects it; anything else
    // (an enemy piece, or an empty square) also drops the selection.
    if (ownHumanPiece && this.pointerDownSelectionId !== piece.id) {
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
    if (
      !piece ||
      piece.color !== this.game.state.turn ||
      this.game.players[piece.color].type !== "human"
    ) {
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

  setInCheck(color: "black" | "white", isInCheck: boolean): void {
    if (!isInCheck) {
      this.boardView.setCheckMarker(null);
      return;
    }
    const king = this.game.state.pieces.find(
      (i) => i.type.royal && i.color === color,
    );
    this.boardView.setCheckMarker(king ? king.position : null);
  }

  setGameEnd(status: GameStatus, color: "black" | "white"): void {
    this.gameEnded = true;
    this.clearSelection();
    if (status === "checkmate") {
      const king = this.game.state.pieces.find(
        (piece) => piece.type.royal && piece.color === color,
      );
      this.boardView.setCheckmatedKing(king ? king.id : null);
    }
    this.scoreWidget.classList.remove("hidden");
    if (status === "stalemate") {
      this.scoreDisplay.textContent = "½-½";
    } else {
      this.scoreDisplay.textContent = color === "white" ? "0-1" : "1-0";
    }
  }

  selectPiece(piece: Piece): void {
    if (
      piece.color === this.game.state.turn &&
      this.game.players[piece.color].type === "human"
    ) {
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
  private updateCheckMarkers(state: ChessBoardState): void {
    const color = state.turn;
    const king = state.pieces.find(
      (piece) => piece.type.royal && piece.color === color,
    );
    const inCheck = isInCheck(color, state);
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
   * Clicking anywhere off the board drops the movement selection. The sidebar is
   * left alone, so the last inspected piece stays on display.
   */
  private onDocumentPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.handlingPromotion) return;
    const target = event.target as Node | null;
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
