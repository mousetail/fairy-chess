import { gameHash, gameIdFromHash } from "./online/game-link.ts";
import type { Screen } from "./screen.ts";

/**
 * Where the app can be, as named by the address bar.
 *
 * A game is named by its UUID, which is what makes a game's page shareable and
 * what brings a reload back to the game it was playing. The other pages are
 * named by a fixed word. Anything the address bar holds that names no page is
 * read as the home page, so a stray fragment never leaves a blank screen.
 */
export type Route =
  | { kind: "home" }
  | { kind: "discoveries" }
  | { kind: "history" }
  | { kind: "game"; gameId: string };

/** What the router asks of the app to put each route's page on screen. */
export interface RouteHandlers {
  home(): void;
  discoveries(): void;
  history(): void;
  game(gameId: string): void;
}

/** The route the fragment `hash` names. */
export function routeFromHash(hash: string): Route {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment === "") return { kind: "home" };
  if (fragment === "discoveries") return { kind: "discoveries" };
  if (fragment === "history") return { kind: "history" };
  const gameId = gameIdFromHash(hash);
  if (gameId !== null) return { kind: "game", gameId };
  return { kind: "home" };
}

/** The fragment that names `route`, to put in the address bar. */
export function hashForRoute(route: Route): string {
  switch (route.kind) {
    case "home":
      return "";
    case "discoveries":
      return "#discoveries";
    case "history":
      return "#history";
    case "game":
      return gameHash(route.gameId);
  }
}

/** Whether two routes name the same page. */
function sameRoute(a: Route, b: Route): boolean {
  if (a.kind === "game" && b.kind === "game") return a.gameId === b.gameId;
  return a.kind === b.kind;
}

/**
 * The app's router: it owns which page is on screen and keeps it in step with
 * the address bar.
 *
 * The address bar is the single source of truth for where the app is. A change
 * to it — made by hand, by a link, or by the back and forward buttons — puts the
 * page its fragment names on screen, and a page the app shows itself writes its
 * route back to the address bar. Programmatic navigation writes to the history
 * directly rather than through `location.hash`, so the browser does not report
 * the app's own move back to it as a navigation.
 */
export class Router {
  private readonly parent: HTMLElement;
  private readonly routes: RouteHandlers;
  /** The page on screen, or `null` before the first one is shown. */
  private screen: Screen | null = null;
  /** The route the address bar was last known to name. */
  private route: Route | null = null;

  constructor(parent: HTMLElement, routes: RouteHandlers) {
    this.parent = parent;
    this.routes = routes;
  }

  /** Shows the page the address bar names, and follows it from then on. */
  start(): void {
    window.addEventListener("hashchange", this.followAddressBar);
    window.addEventListener("popstate", this.followAddressBar);
    this.dispatch(routeFromHash(window.location.hash));
  }

  /**
   * Goes to `route`: names it in the address bar and shows its page. Asking for
   * the route already showing shows it again, so a page can be rebuilt in place.
   */
  navigate(route: Route): void {
    this.setHash(hashForRoute(route));
    this.dispatch(route);
  }

  /**
   * Shows `screen` in place of whatever was on screen, naming `route` in the
   * address bar when one is given.
   *
   * This is for the pages that are not reached by their fragment alone: a game
   * played on this machine, which has no link of its own, and a game the server
   * has just started, whose page goes up the moment its route is written.
   */
  show(screen: Screen, route?: Route): void {
    if (route !== undefined) {
      this.route = route;
      this.setHash(hashForRoute(route));
    }
    this.screen?.deactivate();
    this.screen = screen;
    screen.activate(this.parent);
  }

  /** Puts the page the address bar now names on screen, if it has changed. */
  private readonly followAddressBar = (): void => {
    const route = routeFromHash(window.location.hash);
    if (this.route !== null && sameRoute(this.route, route)) return;
    this.dispatch(route);
  };

  private dispatch(route: Route): void {
    this.route = route;
    switch (route.kind) {
      case "home":
        this.routes.home();
        return;
      case "discoveries":
        this.routes.discoveries();
        return;
      case "history":
        this.routes.history();
        return;
      case "game":
        this.routes.game(route.gameId);
        return;
    }
  }

  /**
   * Names `hash` in the address bar without reporting it back as a navigation.
   * The history is written to directly for that reason; `location.hash` would
   * fire a `hashchange` the router would then answer a second time.
   */
  private setHash(hash: string): void {
    if (window.location.hash === hash) return;
    const url =
      hash === "" ? window.location.pathname + window.location.search : hash;
    window.history.pushState(null, "", url);
  }
}
