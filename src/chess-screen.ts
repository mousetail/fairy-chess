import {
  cloneChessBoardState,
  movementHasNoPendingPromotion,
  movementHasPendingPromotion,
  pieceTypes,
  specialMovementToPgn,
  type Piece,
  type SpecialMovement,
  type TaggedMove,
} from "./chess-board";
import { ChessGame, type GameStatus } from "./chess-game";
import type { Tile } from "./chess-tile";
import { HistoryBar } from "./history-bar";
import type { PieceImage } from "./images/images";
import type { LazyImage } from "./pieces/utils";
import type { Screen } from "./screen";

function getImageFromPromise(
  v: LazyImage,
  color: "black" | "white",
): HTMLImageElement {
  if (v.state === "pending") {
    const img = document.createElement("img");
    v.promise().then((image: PieceImage) => {
      img.src = image[color];

      Object.assign(v, { state: "resolved" }, image);
    });

    return img;
  }
  const img = document.createElement("img");
  img.src = v[color];
  return img;
}

export default class ChessScreen implements Screen {
  game: ChessGame;
  boardDiv: HTMLDivElement;
  movesLog: HTMLDivElement;
  pips: HTMLDivElement[] = [];
  piecesDivs: Map<number, HTMLImageElement> = new Map();
  historyBar: HistoryBar | null = null;

  selectedPiece: { piece: Piece; moves: SpecialMovement[] } | null = null;
  handlingPromotion: boolean = false;
  gameEnded: boolean = false;
  highlightedTiles: HTMLDivElement[] = [];
  checkMarker: HTMLDivElement;
  scoreWidget: HTMLDivElement;
  scoreDisplay: HTMLDivElement;
  playAgainButton: HTMLButtonElement;

  constructor() {
    this.game = ChessGame.defaultLayout();
    this.boardDiv = document.createElement("div");
    this.movesLog = document.createElement("div");
    this.checkMarker = document.createElement("div");
    this.checkMarker.classList.add("check-marker");

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


    this.boardDiv = document.createElement("div");
    this.boardDiv.classList.add("board-outer");

    const boardDivInner = document.createElement("div");
    this.boardDiv.appendChild(boardDivInner);
    for (let i = 0; i < 8; i++) {
      const row = document.createElement("div");
      row.classList.add("row");
      for (let j = 0; j < 8; j++) {
        const cell = document.createElement("div");
        cell.classList.add("cell", (i + j) % 2 == 0 ? "even" : "odd");

        cell.addEventListener("click", () => {
          this.clickTile({ x: j, y: 7 - i });
        });

        row.appendChild(cell);
      }
      boardDivInner.appendChild(row);
    }
    leftColumn.appendChild(this.boardDiv);
    for (const piece of this.game.state.pieces) {
      const image = getImageFromPromise(piece.type.image, piece.color);
      image.classList.add("board-piece");
      this.piecesDivs.set(piece.id, image);
      this.boardDiv.appendChild(image);

      image.style.setProperty("--x", `${piece.position.x}`);
      image.style.setProperty("--y", `${piece.position.y}`);
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
      this.piecesDivs.forEach((i) => i.remove());
      this.piecesDivs.clear();
      for (const piece of state.pieces) {
        this.addPiece(piece);
      }
      if (state.lastMove) {
        this.setHighlightedMoves(state.lastMove);
      }
    });
  }

  clearSelection(): void {
    this.pips.forEach((pip) => pip.remove());
    this.selectedPiece = null;
    this.pips = [];
  }

  /**
   * Moves are only allowed while the present position is shown and the game
   * has not finished.
   */
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
        if (movementHasPendingPromotion(move)) {
          this.showPromotionOptions(this.selectedPiece.piece, move);
          this.clearSelection();
          return;
        } else if (movementHasNoPendingPromotion(move)) {
          this.resolveMove(this.selectedPiece.piece, move);
        } else {
          throw new Error("Unreachable!");
        }
      } else {
        this.clearSelection();
      }
    } else {
      this.clearSelection();
    }
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
      this.movePiece.bind(this),
      this.destroyPiece.bind(this),
      this.addPiece.bind(this),
      this.setInCheck.bind(this),
      this.setGameEnd.bind(this)
    );
    this.setHighlightedMoves(taggedMove);

    this.historyBar!.addLogEntry(cloneChessBoardState(this.game.state), pgn);
    this.clearSelection();
  }

  showPromotionOptions(
    piece: Piece,
    move: SpecialMovement & { promotion: { state: "pending" } },
  ): void {
    const dialogue = document.createElement("div");
    dialogue.classList.add("promotion-dialogue");
    this.handlingPromotion = true;

    const options = move.promotion.options;
    for (const option of options) {
      const button = document.createElement("button");
      button.classList.add("promotion-dialogue-button");

      const image = getImageFromPromise(option.image, piece.color);
      button.appendChild(image);

      button.addEventListener("click", () => {
        this.handlingPromotion = false;
        this.resolveMove(piece, {
          ...move,
          promotion: { state: "resolved", piece: option },
        });
        dialogue.remove();
      });
      dialogue.appendChild(button);
    }

    this.boardDiv.appendChild(dialogue);
  }

  setInCheck(color: "black" | "white", isInCheck: boolean): void {
    if (isInCheck) {
      const king = this.game.state.pieces.find(i => i.type === pieceTypes.king && i.color === color);
      if (!king) {
        this.checkMarker.remove();
        return;
      };

      this.checkMarker.style.setProperty("--x", `${king.position.x}`);
      this.checkMarker.style.setProperty("--y", `${king.position.y}`);
      this.boardDiv.appendChild(this.checkMarker);
    } else {
      this.checkMarker.remove();
    }
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

  addPiece(piece: Piece): void {
    const image = getImageFromPromise(piece.type.image, piece.color);
    image.classList.add("board-piece");
    this.piecesDivs.set(piece.id, image);
    this.boardDiv.appendChild(image);
    image.style.setProperty("--x", `${piece.position.x}`);
    image.style.setProperty("--y", `${piece.position.y}`);
  }

  destroyPiece(id: number): void {
    const image = this.piecesDivs.get(id);
    if (!image) {
      throw new Error(`Piece to destroy not found: ${id}`);
    }
    image.remove();
    this.piecesDivs.delete(id);
  }

  movePiece(pieceId: number, tile: Tile): void {
    const image = this.piecesDivs.get(pieceId);
    if (!image) {
      throw new Error(`Piece to move not found: ${pieceId}`);
    }
    image.style.setProperty("--x", `${tile.x}`);
    image.style.setProperty("--y", `${tile.y}`);
  }

  selectPiece(piece: Piece): void {
    if (
      piece.color === this.game.state.turn &&
      this.game.players[piece.color].type === "human"
    ) {
      this.clearSelection();
      const moves = this.game.getValidMoves(piece);
      this.selectedPiece = { piece, moves };

      for (const move of moves) {
        const pip = document.createElement("div");
        pip.classList.add(move.type === "capture" ? "border" : "pip");
        pip.style.setProperty("--x", `${move.to.x}`);
        pip.style.setProperty("--y", `${move.to.y}`);

        this.boardDiv.appendChild(pip);

        this.pips.push(pip);
      }
    }
  }

  setHighlightedMoves(latestMove: TaggedMove): void {
    this.highlightedTiles.forEach((tile) =>
      tile.classList.remove("highlighted"),
    );
    this.highlightedTiles = [
      this.boardDiv.firstChild?.childNodes[7 - latestMove.from.y].childNodes[
        latestMove.from.x
      ] as HTMLDivElement,
      this.boardDiv.firstChild?.childNodes[7 - latestMove.to.y].childNodes[
        latestMove.to.x
      ] as HTMLDivElement,
    ];
    this.highlightedTiles.forEach((tile) => tile.classList.add("highlighted"));
  }

  deactivate(): void {}
}
