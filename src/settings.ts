/**
 * The home screen's selections, kept in local storage.
 *
 * They are stored rather than held in memory so a returning player finds the
 * game set up the way they left it, including the name they play online under.
 */

/** The key the settings are stored under in local storage. */
const STORAGE_KEY = "fairy-chess.settings";

/** The selections made on the home screen. */
export interface HomeScreenSettings {
  /** One of the modes the home screen offers. */
  mode: string;
  /** The seconds the AI is given for a move. */
  minTurnTime: string;
  /** The index of the AI difficulty slider, as a string. */
  difficulty: string;
  /** The index of the chaos level slider, as a string. */
  chaosLevel: string;
  /** The index of the online time control slider, as a string. */
  timeControl: string;
  /** The name to show an online opponent, or an empty string for none. */
  playerName: string;
}

/** What a player who has never chosen anything gets. */
export const defaultSettings: HomeScreenSettings = {
  mode: "Local",
  minTurnTime: "1",
  difficulty: "1",
  chaosLevel: "2",
  timeControl: "1",
  playerName: "",
};

/**
 * The part of `Storage` the settings need. A test can stand in for it, so the
 * settings can be exercised without a browser.
 */
export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's local storage, or `null` where there is none. */
function browserStorage(): SettingsStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // A browser that refuses access to storage, in private mode for instance.
    return null;
  }
}

/** The stored settings, filled out with the defaults for anything missing. */
export function loadSettings(
  store: SettingsStore | null = browserStorage(),
): HomeScreenSettings {
  if (!store) return { ...defaultSettings };
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return { ...defaultSettings };
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...defaultSettings };
  }
}

/** Stores the settings, doing nothing when there is nowhere to put them. */
export function saveSettings(
  settings: HomeScreenSettings,
  store: SettingsStore | null = browserStorage(),
): void {
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience; a full or blocked store must not break play.
  }
}

/** Rebuilds settings from parsed storage, falling back one field at a time. */
function sanitize(value: unknown): HomeScreenSettings {
  if (typeof value !== "object" || value === null) {
    return { ...defaultSettings };
  }
  const record = value as Record<string, unknown>;
  return {
    mode: text(record, "mode"),
    minTurnTime: text(record, "minTurnTime"),
    difficulty: text(record, "difficulty"),
    chaosLevel: text(record, "chaosLevel"),
    timeControl: text(record, "timeControl"),
    playerName: text(record, "playerName"),
  };
}

function text(
  record: Record<string, unknown>,
  key: keyof HomeScreenSettings,
): string {
  const value = record[key];
  return typeof value === "string" ? value : defaultSettings[key];
}
