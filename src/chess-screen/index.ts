import {
  cloneChessBoardState,
  movementHasNoPendingPromotion,
  movementHasPendingPromotion,
  pieceTypes,
  specialMovementToPgn,
  type Piece,
  type SpecialMovement,
} from "../chess-board";
import { ChessGame, type GameStatus, type Player } from "../chess-game";
import type { Tile } from "../chess-tile";
import { HistoryBar } from "../history-bar";
import type { Screen } from "../screen";
import { AiPlayer } from "../ai/ai-player";
import { ArrowsLayer } from "./arrows-layer";
import { BoardView } from "./board-view";
import { tileFromEvent } from "./board-geometry";
import { PieceDragController } from "./piece-drag-controller";
import { createPromotionDialogue } from "./promotion-dialogue";

export interface ChessScreenOptions {
  white?: Player;
  black?: Player;
}

interface PlayerBar {
  element: HTMLDivElement;
  clock: HTMLDivElement;
}

export default class ChessScreen implements Screen {
  game: ChessGame;
  boardView: BoardView;
  arrowsLayer: ArrowsLayer;
  dragController: PieceDragController;
  movesLog: HTMLDivElement;
  historyBar: HistoryBar | null = null;

  selectedPiece: { piece: Piece; moves: SpecialMovement[] } | null = null;
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
    this.game = ChessGame.defaultLayout();
    this.game.players = {
      white: options.white ?? { type: "human" },
      black: options.black ?? { type: "human" },
    };

    const aiConfig = [
      this.game.players.white,
      this.game.players.black,
    ].find((player) => player.type === "ai");
    if (aiConfig?.type === "ai") {
      this.aiPlayer = new AiPlayer({
        minTurnTimeMs: aiConfig.minTurnTimeMs,
        difficulty: aiConfig.difficulty,
      });
      this.aiPlayer.onError((message) => {
        this.aiError = message;
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
    this.playAgainButton.addEventListener("click", () => {
      this.deactivate();
      new ChessScreen(this.options).activate(parent);
    });

    this.historyBar = new HistoryBar(sidebar, (state) => {
      this.clearSelection();
      this.boardView.clearPieces();
      for (const piece of state.pieces) {
        this.boardView.addPiece(piece);
      }
      if (state.lastMove) {
        this.boardView.setHighlightedMoves(state.lastMove);
      }
    });

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
      this.startPieceDrag(event);
    }
  }

  canInteract(): boolean {
    return !this.gameEnded && this.historyBar?.isAtPresent() === true;
  }

  clickTile(tile: Tile): void {
    if (this.handlingPromotion || this.aiThinking) return;
    if (!this.canInteract()) return;

    const piece = this.game.getPieceAt(tile);
    if (
      piece?.color === this.game.state.turn &&
      this.game.players[piece.color].type === "human"
    ) {
      this.selectPiece(piece);
    } else if (this.selectedPiece !== null) {
      const move = this.selectedPiece.moves.find(
        (move) => move.to.x === tile.x && move.to.y === tile.y,
      );

      if (move) {
        this.performMove(this.selectedPiece.piece, move);
      } else {
        this.clearSelection();
      }
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
    if (this.handlingPromotion || this.aiThinking || !this.canInteract()) return;

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

    this.historyBar!.addLogEntry(cloneChessBoardState(this.game.state), pgn);
    this.arrowsLayer.clear();
    this.clearSelection();
    this.plyCount++;
    this.updateTurnIndicator();
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
      (i) => i.type === pieceTypes.king && i.color === color,
    );
    this.boardView.setCheckMarker(king ? king.position : null);
  }

  setGameEnd(status: GameStatus, color: "black" | "white"): void {
    this.gameEnded = true;
    this.clearSelection();
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
    }
  }

  deactivate(): void {
    this.disposed = true;
    this.aiPlayer?.dispose();
    this.aiPlayer = null;
  }

  private maybeRunAi(): void {
    if (!this.aiPlayer || this.aiError || this.gameEnded || this.disposed) return;
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
      alert(`Fairy Stockfish failed: ${this.aiError}`);
    } finally {
      this.aiThinking = false;
    }
  }

  private createPlayerBar(name: string): PlayerBar {
    const element = document.createElement("div");
    element.classList.add("player-bar");

    const nameElement = document.createElement("div");
    nameElement.classList.add("player-name");
    nameElement.textContent = name;

    const clock = document.createElement("div");
    clock.classList.add("player-clock");
    clock.textContent = "--:--";

    element.appendChild(nameElement);
    element.appendChild(clock);
    return { element, clock };
  }

  private playerLabel(player: Player): string {
    if (player.type === "human") return "Human";
    const name = player.engine === "fairy-stockfish" ? "Fairy Stockfish" : player.engine;
    return `${name} (difficulty ${player.difficulty})`;
  }

  private updateTurnIndicator(): void {
    const turn = this.game.state.turn;
    this.blackPlayerBar.clock.classList.toggle("active", turn === "black");
    this.whitePlayerBar.clock.classList.toggle("active", turn === "white");
  }
}