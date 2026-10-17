import { invertColor } from "./chess-board.ts";
import ChessScreen, { type ChessScreenOptions } from "./chess-screen/index.ts";
import { DiscoveriesScreen } from "./discoveries-screen.ts";
import { HistoryScreen } from "./history-screen.ts";
import { HomeScreen } from "./home-screen.ts";
import type { Color } from "./online/protocol.ts";
import {
  type OnlineGame,
  MatchmakingSession,
  type ReviewedGame,
} from "./online/session.ts";
import { Router } from "./router.ts";
import {
  type HomeScreenSettings,
  loadSettings,
  saveSettings,
} from "./settings.ts";

/**
 * The application: the screens, and whatever outlives them.
 *
 * Where the app is is the router's to say, so this class only builds each page
 * and keeps the things that carry across a visit to another one: the session
 * that holds a game, and the selections the home screen shows.
 */
export class App {
  private readonly matchmaking: MatchmakingSession;
  private readonly router: Router;
  /** The selections the home screen shows, kept and stored between visits. */
  private settings: HomeScreenSettings = loadSettings();

  constructor(parent: HTMLElement) {
    this.matchmaking = new MatchmakingSession({
      onGame: (game) => this.startGame(game),
      onReview: (game) => this.showReview(game),
    });
    this.router = new Router(parent, {
      home: () => this.showHome(),
      discoveries: () => this.showDiscoveries(),
      history: () => this.showHistory(),
      game: (gameId) => this.openGame(gameId),
    });
  }

  /** Shows the page the address bar names, and follows it from then on. */
  start(): void {
    this.router.start();
  }

  /** Builds the home screen, where a search for an opponent can be started. */
  private showHome(): void {
    this.router.show(
      new HomeScreen(this.matchmaking, {
        settings: this.settings,
        onSettingsChange: (settings) => {
          this.settings = settings;
          saveSettings(settings);
        },
        onDiscoveries: () => this.router.navigate({ kind: "discoveries" }),
        onLocalGame: (options) => this.showLocalGame(options),
        onHistory: () => this.router.navigate({ kind: "history" }),
      }),
      { kind: "home" },
    );
  }

  private showDiscoveries(): void {
    this.router.show(
      new DiscoveriesScreen(() => this.router.navigate({ kind: "home" })),
      { kind: "discoveries" },
    );
  }

  private showHistory(): void {
    this.router.show(
      new HistoryScreen(() => this.router.navigate({ kind: "home" })),
      { kind: "history" },
    );
  }

  /** Puts a game played on this machine on screen, from the selections made. */
  private showLocalGame(options: ChessScreenOptions): void {
    this.router.show(
      new ChessScreen({
        ...options,
        onPlayAgain: () => this.router.navigate({ kind: "home" }),
      }),
    );
  }

  /**
   * Opens the game `gameId` names: the one already being played, put back on
   * screen, or one this browser asks the server to take its seat at again.
   */
  private openGame(gameId: string): void {
    const game = this.matchmaking.currentGame;
    if (game !== null && game.gameId === gameId) {
      // The game is still under way: its board goes back up, and the server is
      // asked for the moves played since it was last on screen.
      this.startGame(game, false);
      this.matchmaking.refresh();
      return;
    }
    this.matchmaking.resume(gameId);
  }

  /**
   * Puts the board on screen and connects it to the game the server started.
   *
   * `heldState` says whether the state the game is holding may be shown right
   * away. It may for a game just handed over, but not for one put back on screen
   * after the player looked away, whose board and move log have moved on since;
   * that one waits for the server to say what it is holding.
   */
  private startGame(game: OnlineGame, heldState = true): void {
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
      onPlayAgain: () => this.router.navigate({ kind: "home" }),
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
    this.router.show(screen, { kind: "game", gameId: game.gameId });
    // The position, clocks, offers and move log the server is holding are
    // applied after the screen is up: a fresh game's are the same ones its
    // options already carry, and a rejoined game's replace them.
    if (heldState) {
      screen.applyResume(game.board, game.clock, game.drawOffers, game.history);
    }
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
      onPlayAgain: () => this.router.navigate({ kind: "home" }),
    });

    // The game's name stays in the address bar: it is the link that was followed.
    this.router.show(screen, { kind: "game", gameId: game.gameId });
    screen.showReview(game.moves, game.result);
  }
}
