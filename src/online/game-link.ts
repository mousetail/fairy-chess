import { isPlayerId } from "./protocol.ts";

/**
 * How a game is named in the address bar.
 *
 * A game's UUID is put in the URL's hash, so a player who reloads the page — or
 * who follows a link someone sent them — is taken back to the game they were
 * playing. The hash is used rather than the path or query because it never
 * leaves the browser: the server never sees it, and a static host never has to
 * know about it.
 */

/** What a game's fragment starts with. */
const prefix = "#/game/";

/** The game named by `hash`, or `null` when it names none. */
export function gameIdFromHash(hash: string): string | null {
  if (!hash.startsWith(prefix)) return null;
  const id = hash.slice(prefix.length);
  return isPlayerId(id) ? id : null;
}

/** The fragment that names `gameId`, to put in the address bar. */
export function gameHash(gameId: string): string {
  return `${prefix}${gameId}`;
}