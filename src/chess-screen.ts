import {
  movementHasNoPendingPromotion,
  movementHasPendingPromotion,
  specialMovementToPgn,
  type Piece,
  type SpecialMovement,
  type TaggedMove,
} from "./chess-board";
import { ChessGame } from "./chess-game";
import type { Tile } from "./chess-tile";
import type { Screen } from "./screen";

export default class ChessScreen implements Screen {
  game: ChessGame;
  boardDiv: HTMLDivElement;
  movesLog: HTMLDivElement;
  pips: HTMLDivElement[] = [];
  piecesDivs: Map<number, HTMLImageElement> = new Map();

  selectedPiece: { piece: Piece; moves: SpecialMovement[] } | null = null;
  handlingPromotion: boolean = false;

  constructor() {
    this.game = ChessGame.defaultLayout();
    this.boardDiv = document.createElement("div");
    this.movesLog = document.createElement("div");
  }

  activate(parent: HTMLElement): void {
    parent.replaceChildren();

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
    parent.appendChild(this.boardDiv);
    for (const piece of this.game.state.pieces) {
      const image = document.createElement("img");
      image.classList.add("board-piece");
      image.src = piece.type.image[piece.color];
      this.piecesDivs.set(piece.id, image);
      this.boardDiv.appendChild(image);

      image.style.setProperty("--x", `${piece.position.x}`);
      image.style.setProperty("--y", `${piece.position.y}`);
    }

    this.movesLog = document.createElement("div");
    this.movesLog.classList.add("moves-log");

    parent.appendChild(this.movesLog);
  }

  clearSelection(): void {
    this.pips.forEach((pip) => pip.remove());
    this.selectedPiece = null;
    this.pips = [];
  }

  clickTile(tile: Tile): void {
    if (this.handlingPromotion) return;

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
    const taggedMove = { ...move, from: piece.position, piece };
    this.addLogEntry(taggedMove);
    this.game.movePiece(
      taggedMove,
      this.movePiece.bind(this),
      this.destroyPiece.bind(this),
      this.addPiece.bind(this),
    );
    this.clearSelection();
  }

  addLogEntry(move: TaggedMove): void {
    const div = document.createElement("div");
    div.classList.add("move-log-entry");
    this.movesLog.appendChild(div);
    const moveNumber = Math.floor(this.movesLog.children.length / 2) + 1;
    div.textContent =
      (this.movesLog.children.length % 2 === 1 ? moveNumber + ". " : "") +
      specialMovementToPgn(move, this.game.state);
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

      const image = document.createElement("img");
      image.src = option.image[piece.color];
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

  addPiece(piece: Piece): void {
    const image = document.createElement("img");
    image.classList.add("board-piece");
    image.src = piece.type.image[piece.color];
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

  deactivate(): void {}
}
