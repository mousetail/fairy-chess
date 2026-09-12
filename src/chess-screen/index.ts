import {
  cloneChessBoardState,
  movementHasNoPendingPromotion,
  movementHasPendingPromotion,
  pieceTypes,
  specialMovementToPgn,
  type Piece,
  type SpecialMovement,
} from "../chess-board";
import { ChessGame, type GameStatus } from "../chess-game";
import type { Tile } from "../chess-tile";
import { HistoryBar } from "../history-bar";
import type { Screen } from "../screen";
import { ArrowsLayer } from "./arrows-layer";
import { BoardView } from "./board-view";
import { tileFromEvent } from "./board-geometry";
import { PieceDragController } from "./piece-drag-controller";
import { createPromotionDialogue } from "./promotion-dialogue";

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

  constructor() {
    this.game = ChessGame.defaultLayout();

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
  }

  activate(parent: HTMLElement): void {
    parent.replaceChildren();

    const leftColumn = document.createElement("div");
    leftColumn.classList.add("left-column");
    parent.appendChild(leftColumn);

    this.boardView.clearPieces();
    leftColumn.appendChild(this.boardView.element);
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
      new ChessScreen().activate(parent);
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
    if (this.handlingPromotion) return;
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
    if (this.handlingPromotion || !this.canInteract()) return;

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

  deactivate(): void {}
}