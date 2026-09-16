import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyGame,
  discoverySummaryText,
  loadDiscoveries,
  saveDiscoveries,
  summarize,
  type DiscoveryRecords,
} from "../src/discoveries.ts";
import pieceTypes from "../src/pieces/piece_types/index.ts";
import kingPieces from "../src/pieces/piece_types/kings.ts";
import pawnPieces from "../src/pieces/piece_types/pawns.ts";

/** A minimal in-memory `Storage`, installed as `globalThis.localStorage`. */
function withStorage(run: (store: Map<string, string>) => void): void {
  const store = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
  try {
    run(store);
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, "localStorage", previous);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  }
}

test("a finished game credits every piece that was in play", () => {
  const records = applyGame(
    {},
    {
      pieces: [pieceTypes.rook, pieceTypes.pawn, pieceTypes.overlord],
      outcome: "win",
      opponentName: "Fairy Stockfish (difficulty 3)",
    },
  );

  assert.deepEqual(records.rook, {
    wins: 1,
    losses: 0,
    ties: 0,
    defeatedOpponents: ["Fairy Stockfish (difficulty 3)"],
  });
  assert.equal(records.pawn.wins, 1);
  assert.equal(records.overlord.wins, 1);
});

test("a piece counts regardless of which player had it", () => {
  // The overlord is a king variant that only one side fields, but it is still
  // part of the script, so it is credited like any other piece.
  const records = applyGame(
    {},
    { pieces: [pieceTypes.overlord], outcome: "loss", opponentName: "Human" },
  );
  assert.equal(records.overlord.losses, 1);
  assert.deepEqual(records.overlord.defeatedOpponents, []);
});

test("losses and ties increment their own counters", () => {
  let records: DiscoveryRecords = {};
  records = applyGame(records, {
    pieces: [pieceTypes.knight],
    outcome: "loss",
    opponentName: "Human",
  });
  records = applyGame(records, {
    pieces: [pieceTypes.knight],
    outcome: "tie",
    opponentName: "Human",
  });
  assert.deepEqual(records.knight, {
    wins: 0,
    losses: 1,
    ties: 1,
    defeatedOpponents: [],
  });
});

test("beaten opponents are recorded once each", () => {
  let records: DiscoveryRecords = {};
  for (let i = 0; i < 2; i++) {
    records = applyGame(records, {
      pieces: [pieceTypes.queen],
      outcome: "win",
      opponentName: "Fairy Stockfish (difficulty 1)",
    });
  }
  records = applyGame(records, {
    pieces: [pieceTypes.queen],
    outcome: "win",
    opponentName: "Human",
  });

  assert.equal(records.queen.wins, 3);
  assert.deepEqual(records.queen.defeatedOpponents, [
    "Fairy Stockfish (difficulty 1)",
    "Human",
  ]);
});

test("summarize counts discovered and won-with pieces by category", () => {
  const records = applyGame(
    {},
    {
      pieces: [pieceTypes.pawn, pieceTypes.overlord, pieceTypes.rook],
      outcome: "win",
      opponentName: "Human",
    },
  );
  const summary = summarize(records);

  assert.equal(summary.discovered, 3);
  assert.equal(summary.discoveredPawns, 1);
  assert.equal(summary.discoveredKings, 1);
  assert.equal(summary.wonWith, 3);
  assert.equal(summary.wonWithPawns, 1);
  assert.equal(summary.wonWithKings, 1);
});

test("pieces that never finished a game stay undiscovered", () => {
  const summary = summarize({});
  assert.equal(summary.discovered, 0);
  assert.equal(summary.wonWith, 0);
  assert.equal(
    discoverySummaryText(summary),
    "You have discovered 0 pieces including 0 pawn types and 0 king types. " +
      "You have won with 0 pieces, including 0 pawn types and 0 king types.",
  );
});

test("the summary counts every piece type the game knows about", () => {
  const records: DiscoveryRecords = {};
  for (const key of Object.keys(pieceTypes)) {
    records[key] = { wins: 1, losses: 0, ties: 0, defeatedOpponents: [] };
  }
  const summary = summarize(records);
  assert.equal(summary.discovered, Object.keys(pieceTypes).length);
  // The classic pawn and king count as variants too, matching the counts the
  // home screen's description advertises.
  assert.equal(summary.discoveredPawns, Object.keys(pawnPieces).length + 1);
  assert.equal(summary.discoveredKings, Object.keys(kingPieces).length + 1);
});

test("records survive a save and load round trip", () => {
  withStorage(() => {
    const records = applyGame(
      {},
      {
        pieces: [pieceTypes.bishop],
        outcome: "win",
        opponentName: "Human",
      },
    );
    saveDiscoveries(records);
    assert.deepEqual(loadDiscoveries(), records);
  });
});

test("malformed stored data is discarded", () => {
  withStorage((store) => {
    store.set(
      "fairy-chess.discoveries",
      JSON.stringify({
        rook: { wins: 2, losses: "many", ties: -1, defeatedOpponents: [1, "Human"] },
        notAPiece: { wins: 5, losses: 0, ties: 0, defeatedOpponents: [] },
        knight: "nonsense",
      }),
    );
    assert.deepEqual(loadDiscoveries(), {
      rook: { wins: 2, losses: 0, ties: 0, defeatedOpponents: ["Human"] },
    });
  });
});
