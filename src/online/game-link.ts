import { isPlayerId } from "./protocol.ts";

/**
 * How a game is named in the address bar.
 *
 * A game's UUID is put in the URL's hash, so a player who reloads the page — or
 * who follows a link someone sent them — is taken back to the game they were
 * playing, and a finished game can be shared and read again. The hash is used
 * rather than the path or query because it never leaves the browser: the server
 * never sees it, and a static host never has to know about it.
 */

/** What an older link may write before the game's UUID. */
const prefix = "/game/";

/**
 * The game named by `hash`, or `null` when it names none.
 *
 * The id is written on its own, as `#<uuid>`; the `#/game/<uuid>` form of a
 * link made by an older build is still read.
 */
export function gameIdFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const id = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return isPlayerId(id) ? id : null;
}

/** The fragment that names `gameId`, to put in the address bar. */
export function gameHash(gameId: string): string {
  return `#${gameId}`;
}
