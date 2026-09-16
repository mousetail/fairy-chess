import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  type SettingsStore,
} from "../src/settings.ts";

/** A storage that keeps what it is given, for a test to look at. */
function fakeStore(initial: Record<string, string> = {}): SettingsStore {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

test("settings that were never stored fall back to the defaults", () => {
  assert.deepEqual(loadSettings(fakeStore()), defaultSettings);
  assert.deepEqual(loadSettings(null), defaultSettings);
});

test("settings survive a save and load round trip", () => {
  const store = fakeStore();
  const settings = {
    mode: "Online",
    minTurnTime: "2.5",
    difficulty: "5",
    chaosLevel: "4",
    playerName: "Ada",
  };

  saveSettings(settings, store);
  assert.deepEqual(loadSettings(store), settings);
});

test("a missing field is filled in from the defaults", () => {
  const store = fakeStore({
    "fairy-chess.settings": JSON.stringify({ playerName: "Ada" }),
  });

  assert.deepEqual(loadSettings(store), {
    ...defaultSettings,
    playerName: "Ada",
  });
});

test("stored data that is not settings at all is discarded", () => {
  for (const stored of ["not json", "[]", "null", '"Ada"', "7"]) {
    const store = fakeStore({ "fairy-chess.settings": stored });
    assert.deepEqual(
      loadSettings(store),
      defaultSettings,
      `expected ${stored} to be discarded`,
    );
  }
});

test("fields of the wrong type are replaced one at a time", () => {
  const store = fakeStore({
    "fairy-chess.settings": JSON.stringify({
      mode: "Online",
      minTurnTime: 4,
      difficulty: null,
      chaosLevel: "1",
      playerName: ["Ada"],
    }),
  });

  assert.deepEqual(loadSettings(store), {
    mode: "Online",
    minTurnTime: defaultSettings.minTurnTime,
    difficulty: defaultSettings.difficulty,
    chaosLevel: "1",
    playerName: defaultSettings.playerName,
  });
});

test("saving without anywhere to put the settings is harmless", () => {
  saveSettings(defaultSettings, null);
  const refusing: SettingsStore = {
    getItem: () => null,
    setItem: () => {
      throw new Error("the store is full");
    },
  };
  saveSettings(defaultSettings, refusing);
});