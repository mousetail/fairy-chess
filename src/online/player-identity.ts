import { isPlayerId } from "./protocol.ts";

/**
 * The identifier a player is known by online, kept in local storage.
 *
 * The browser makes the identifier once and keeps it, so the player is the same
 * player to the server across reloads and restarts: it is what a seat at a game
 * is held for, and what lets a reopened page take that seat back. It is never
 * shown to another player.
 */

/** The key the identifier is stored under in local storage. */
const STORAGE_KEY = "fairy-chess.playerId";

/**
 * The part of `Storage` the identifier needs. A test can stand in for it, so the
 * identifier can be exercised without a browser.
 */
export interface IdentityStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's local storage, or `null` where there is none. */
function browserStorage(): IdentityStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // A browser that refuses access to storage, in private mode for instance.
    return null;
  }
}

/**
 * The identifier this browser plays under, making and storing one the first time
 * it is asked. A stored value that is not a usable identifier is replaced rather
 * than trusted.
 */
export function loadPlayerId(store: IdentityStore | null = browserStorage()): string {
  let stored: string | null = null;
  try {
    stored = store?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // An unreadable store is the same as an empty one here.
  }
  if (isPlayerId(stored)) return stored;

  const made = crypto.randomUUID();
  savePlayerId(made, store);
  return made;
}

/** Stores the identifier the server answered with, when it is not the one sent. */
export function savePlayerId(
  id: string,
  store: IdentityStore | null = browserStorage(),
): void {
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, id);
  } catch {
    // An identifier that cannot be stored still works for this visit.
  }
}