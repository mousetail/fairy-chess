import { invertColor } from "./chess-board.ts";
import ChessScreen, { type ChessScreenOptions } from "./chess-screen/index.ts";
import { DiscoveriesScreen } from "./discoveries-screen.ts";
import { HomeScreen } from "./home-screen.ts";
import type { Color } from "./online/protocol.ts";
import { type OnlineGame, MatchmakingSession } from "./online/session.ts";
import type { Screen } from "./screen.ts";
import { type HomeScreenSettings, loadSettings, saveSettings } from "./settings.ts";

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
    });
  }

  /** Shows the home screen, where a search for an opponent can be started. */
  start(): void {
    this.showHome();
  }

  private show(screen: Screen): void {
    this.screen?.deactivate();
    this.screen = screen;
    screen.activate(this.parent);
  }

  private showHome(): void {
    this.show(
      new HomeScreen(this.matchmaking, {
        settings: this.settings,
        onSettingsChange: (settings) => {
          this.settings = settings;
          saveSettings(settings);
        },
        onDiscoveries: () => this.showDiscoveries(),
        onLocalGame: (options) => this.showLocalGame(options),
      }),
    );
  }

  private showDiscoveries(): void {
    this.show(new DiscoveriesScreen(() => this.showHome()));
  }

  private showLocalGame(options: ChessScreenOptions): void {
    this.show(new ChessScreen({ ...options, onPlayAgain: () => this.showHome() }));
  }

  /** Puts the board on screen and connects it to the game the server started. */
  private startGame(game: OnlineGame): void {
    // Both sides are people, so the bars are named from the server's view of who
    // is who: this browser shows the name it gave, or "You" when it plays
    // anonymously.
    const ownName = game.playerName.trim() || "You";
    const playerNames: Record<Color, string> = game.color === "white"
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
        // Back to the home screen, where another search can be started from the
        // settings that are still on it. Nothing is queued here: a player who
        // has just finished a game decides when to look for the next opponent.
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
      gameOver: (status, winner) => screen.declareResult(status, winner),
      opponentLeft: (winner) => {
        screen.declareResult("resign", winner);
        screen.showNotice("Your opponent left the game.");
      },
      drawOffered: (color) => screen.reportDrawOffer(color),
      drawCancelled: (color) => screen.reportDrawCancelled(color),
      disconnected: () => {
        if (screen.gameEnded) return;
        // Whoever stayed would have been awarded the win, so the game is over
        // here too; the notice says why.
        screen.declareResult("resign", invertColor(game.color));
        screen.showNotice(
          "The connection to the matchmaking server was lost, so the game is over.",
        );
      },
    });

    this.show(screen);
  }
}