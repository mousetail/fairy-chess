import { ChessGame, type Move, type Piece, type SpecialMovement, type TaggedMove, type Tile } from "./chess-game";
import type { Screen } from "./screen";

export default class ChessScreen implements Screen {
  game: ChessGame;
  boardDiv: HTMLDivElement;
  pips: HTMLDivElement[] = [];
  piecesDivs: Map<Piece, HTMLImageElement> = new Map();

  selectedPiece: { piece: Piece; moves: SpecialMovement[] } | null = null;

  constructor() {
    this.game = ChessGame.defaultLayout();
    this.boardDiv = document.createElement("div");
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
          this.clickTile({ x: j, y: i });
        });

        row.appendChild(cell);
      }
      boardDivInner.appendChild(row);
    }
    parent.appendChild(this.boardDiv);
    for (const piece of this.game.pieces) {
      const image = document.createElement("img");
      image.src = piece.type.image[piece.color];
      this.piecesDivs.set(piece, image);
      this.boardDiv.appendChild(image);

      image.style.setProperty('--x', `${piece.position.x}`);
      image.style.setProperty('--y', `${piece.position.y}`);
    }
  }

  clearSelection(): void {
    this.pips.forEach((pip) => pip.remove());
    this.selectedPiece = null;
    this.pips = [];
  }

  clickTile(tile: Tile): void {
    const piece = this.game.getPieceAt(tile);
    if (
      piece?.color === this.game.turn &&
      this.game.players[piece.color].type === "human"
    ) {
      this.selectPiece(piece);
    } else if (this.selectedPiece !== null) {
      const move = this.selectedPiece.moves.find(
        (move) => move.tile.x === tile.x && move.tile.y === tile.y,
      )
      if (
        move
      ) {
        this.game.movePiece(
          this.selectedPiece.piece,
          move,
          this.movePiece.bind(this),
          this.destroyPiece.bind(this),
        );
        this.clearSelection();
      } else {
        this.clearSelection();
      }
    } else {
      this.clearSelection();
    }
  }

  destroyPiece(piece: Piece): void {
    const image = this.piecesDivs.get(piece);
    if (!image) {
      throw new Error(`Piece to destroy not found: ${piece}`);
    }
    image.remove();
    this.piecesDivs.delete(piece);
  }

  movePiece(piece: Piece, tile: Tile): void {
    const image = this.piecesDivs.get(piece);
    if (!image) {
      throw new Error(`Piece to move not found: ${piece}`);
    }
    image.style.setProperty('--x', `${tile.x}`);
    image.style.setProperty('--y', `${tile.y}`);
  }

  selectPiece(piece: Piece): void {
    if (
      piece.color === this.game.turn &&
      this.game.players[piece.color].type === "human"
    ) {
      this.clearSelection();
      const moves = this.game.getValidMoves(piece);
      this.selectedPiece = { piece, moves };

      for (const move of moves) {
        const pip = document.createElement("div");
        pip.classList.add(move.type === 'capture' ? 'border' : 'pip');
        pip.style.setProperty('--x', `${move.tile.x}`);
        pip.style.setProperty('--y', `${move.tile.y}`);

        this.boardDiv.appendChild(pip);

        this.pips.push(pip);
      }
    }
  }

  deactivate(): void {}
}
