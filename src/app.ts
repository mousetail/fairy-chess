import { invertColor } from "./chess-board.ts";
import ChessScreen, { type ChessScreenOptions } from "./chess-screen/index.ts";
import { DiscoveriesScreen } from "./discoveries-screen.ts";
import { HistoryScreen } from "./history-screen.ts";
import { HomeScreen } from "./home-screen.ts";
import { gameHash, gameIdFromHash } from "./online/game-link.ts";
import type { Color } from "./online/protocol.ts";
import {
  type OnlineGame,
  MatchmakingSession,
  type ReviewedGame,
} from "./online/session.ts";
import type { Screen } from "./screen.ts";
import {
  type HomeScreenSettings,
  loadSettings,
  saveSettings,
} from "./settings.ts";

/**
 * The application: the screen on show, and whatever outlives it.
 *
 * Every change of screen goes through here, so the screen being replaced is
 * always the screen that was on show, and can always be taken down properly.
 *
 * The matchmaking session lives here too rather than in a screen. Waiting for an
 * opponent is not a page of its own — the player carries on reading their
 * discoveries, and the board takes over whichever screen is up when somebody
 * turns up to play.
 */
export class App {
  private readonly parent: HTMLElement;
  private readonly matchmaking: MatchmakingSession;
  /** The selections the home screen shows, kept and stored between visits. */
  private settings: HomeScreenSettings = loadSettings();
  private screen: Screen | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.matchmaking = new MatchmakingSession({
      onGame: (game) => this.startGame(game),
      onReview: (game) => this.showReview(game),
    });
  }

  /** Shows the home screen, where a search for an opponent can be started. */
  start(): void {
    if (window.location.hash === "") {
      this.showHome();
      return;
    } else if (window.location.hash === "#discoveries") {
      this.showDiscoveries();
      return;
    } else if (window.location.hash === "#history") {
      this.showHistory();
      return;
    }
    console.error("window.location.hash", window.location.hash);
    const gameId = gameIdFromHash(location.hash);
    if (gameId !== null) return this.matchmaking.resume(gameId);

    this.showHome();
  }

  private show(screen: Screen): void {
    this.screen?.deactivate();
    this.screen = screen;
    screen.activate(this.parent);
  }

  private showHome(): void {
    window.location.hash = "";
    this.show(
      new HomeScreen(this.matchmaking, {
        settings: this.settings,
        onSettingsChange: (settings) => {
          this.settings = settings;
          saveSettings(settings);
        },
        onDiscoveries: () => this.showDiscoveries(),
        onLocalGame: (options) => this.showLocalGame(options),
        onHistory: () => this.showHistory(),
      }),
    );
  }

  private showDiscoveries(): void {
    window.location.hash = "discoveries";
    this.show(new DiscoveriesScreen(() => this.showHome()));
  }

  private showLocalGame(options: ChessScreenOptions): void {
    this.show(new ChessScreen(options));
  }

  private showHistory(): void {
    window.location.hash = "history";
    this.show(
      new HistoryScreen(
        () => this.showHome(),
        (gameId: string) => {
          this.matchmaking.resume(gameId);
        },
      ),
    );
  }

  /** Puts the board on screen and connects it to the game the server started. */
  private startGame(game: OnlineGame): void {
    // Both sides are people, so the bars are named from the server's view of who
    // is who: this browser shows the name it gave, or "You" when it plays
    // anonymously.
    const ownName = game.playerName.trim() || "You";
    const playerNames: Record<Color, string> =
      game.color === "white"
        ? { white: ownName, black: game.opponentName }
        : { white: game.opponentName, black: ownName };

    const screen = new ChessScreen({
      initialBoard: game.board,
      playerNames,
      online: {
        color: game.color,
        timeControl: game.timeControl,
        requestMove: (request) => game.requestMove(request),
        resign: () => game.resign(),
        abort: () => game.abort(),
        offerDraw: () => game.offerDraw(),
        cancelDraw: () => game.cancelDraw(),
      },
      onPlayAgain: () => {
        window.location.hash = "";
        this.showHome();
      },
    });

    game.listen({
      moved: (board, pgn, inCheck, color) =>
        screen.applyServerMove(board, pgn, inCheck, color),
      clock: (white, black, running) =>
        screen.applyClock(white, black, running),
      moveRejected: (rejection) => screen.reportRejection(rejection),
      notice: (text) => screen.showNotice(text),
      gameOver: (status, winner) => {
        // The game's name is left in the address bar: the link still shows it,
        // and it is what makes it shareable.
        screen.declareResult(status, winner);
      },
      opponentAway: () =>
        screen.showNotice(
          "Your opponent's connection dropped.",
        ),
      opponentBack: () => screen.showNotice("Your opponent is back."),
      drawOffered: (color) => screen.reportDrawOffer(color),
      drawCancelled: (color) => screen.reportDrawCancelled(color),
      resuming: (attempt) =>
        screen.showNotice(
          `The connection was lost. Trying to rejoin the game (attempt ${attempt})…`,
        ),
      resumed: (board, clock, drawOffers, history) =>
        screen.applyResume(board, clock, drawOffers, history),
      disconnected: () => {
        if (screen.gameEnded) return;
        // The seat could not be taken back. The server still holds it and this
        // browser's clock is running there, so the game will be lost on time if
        // nobody returns; the board says so here, and a reload can still find
        // the game and take the seat back.
        screen.declareResult("timeout", invertColor(game.color));
        screen.showNotice(
          "The connection to the matchmaking server was lost. The game is over " +
            "here, but reloading this page may still find it.",
        );
      },
    });

    // The game's UUID names it in the address bar, so a reload comes back to it.
    location.hash = gameHash(game.gameId);
    this.show(screen);
    // The position, clocks, offers and move log the server is holding are
    // applied after the screen is up: a fresh game's are the same ones its
    // options already carry, and a rejoined game's replace them.
    screen.applyResume(game.board, game.clock, game.drawOffers, game.history);
  }

  /** Puts a finished game on screen, for reading rather than playing. */
  private showReview(game: ReviewedGame): void {
    const names: Record<Color, string> = {
      white: game.whiteName.trim() || "White",
      black: game.blackName.trim() || "Black",
    };
    const screen = new ChessScreen({
      initialBoard: game.initialBoard,
      playerNames: names,
      // The reader's side is at the bottom when they played, and White's is
      // otherwise, so a game read by a stranger still opens the familiar way.
      orientation: game.color ?? "white",
      review: true,
      onPlayAgain: () => this.showHome(),
    });

    // The game's name stays in the address bar: it is the link that was followed.
    location.hash = gameHash(game.gameId);
    this.show(screen);
    screen.showReview(game.moves, game.result);
  }
}
