import { getImageFromPromise } from "./chess-screen/piece-images.ts";
import { matchmakingUrl } from "./online/config.ts";
import pieceTypes from "./pieces/piece_types/index.ts";
import type { Screen } from "./screen.ts";

export interface GameSummary {
  id: string;
  date: string;
  white: string;
  black: string;
  result: string;
  pieces: string[];
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString();
}

export class HistoryScreen implements Screen {
  private readonly onBack: () => void;
  private readonly onResume: (gameId: string) => void;

  constructor(onBack: () => void, onResume: (gameId: string) => void) {
    this.onBack = onBack;
    this.onResume = onResume;
  }

  activate(parent: HTMLElement): void {
    parent.replaceChildren();

    const container = document.createElement("div");
    container.classList.add("discoveries");
    parent.appendChild(container);

    const header = document.createElement("h1");
    header.textContent = "History";
    container.appendChild(header);

    const table = document.createElement("table");

    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const column of ["black", "white", "winner", "date", "pieces"]) {
      const th = document.createElement("th");
      th.textContent = column;
      tr.appendChild(th);
    }
    thead.appendChild(tr);

    table.appendChild(thead);

    container.appendChild(table);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);

    fetch(
      matchmakingUrl!.replace(/^ws(s?)/, (_, i) => "http" + i) +
        "/history?playerId=" +
        encodeURIComponent(localStorage.getItem("fairy-chess.playerId")!),
    )
      .then((response) => response.json())
      .then((data) => {
        data.forEach((game: GameSummary) => {
          const item = document.createElement("tr");
          item.classList.add("history-page-element");

          const tdWhite = document.createElement("td");
          const linkWhite = document.createElement("a");
          linkWhite.href = "#" + game.id;
          linkWhite.textContent = game.white;
          tdWhite.appendChild(linkWhite);
          item.appendChild(tdWhite);

          const tdBlack = document.createElement("td");
          const linkBlack = document.createElement("a");
          linkBlack.href = "#" + game.id;
          linkBlack.textContent = game.black;
          tdBlack.appendChild(linkBlack);
          item.appendChild(tdBlack);

          [linkBlack, linkWhite].forEach((link) =>
            link.addEventListener("click", () => this.onResume(game.id)),
          );

          const tdResult = document.createElement("td");
          tdResult.textContent = game.result;
          item.appendChild(tdResult);

          const tdDate = document.createElement("td");
          tdDate.textContent = formatDate(game.date);
          item.appendChild(tdDate);

          const tdPieces = document.createElement("td");
          for (const piece of game.pieces) {
            const pieceElement = document.createElement("span");
            const pieceType = pieceTypes[piece];
            const img = getImageFromPromise(pieceType.image, "white");
            pieceElement.appendChild(img);
            tdPieces.appendChild(pieceElement);
          }
          item.appendChild(tdPieces);

          table.appendChild(item);
        });
      });

    const backButton = document.createElement("button");
    backButton.classList.add("button", "play-button");
    backButton.textContent = "Back";
    backButton.addEventListener("click", () => {
      this.deactivate();
      this.onBack();
    });
    container.appendChild(backButton);
  }

  deactivate(): void {}
}
