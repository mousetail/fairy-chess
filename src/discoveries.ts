import pieceTypes, { type PieceType } from "./pieces/piece_types/index.ts";

/** The key discoveries are stored under in local storage. */
const STORAGE_KEY = "fairy-chess.discoveries";

/** How a finished game went for the local player. */
export type GameOutcome = "win" | "loss" | "tie";

/** What the player has done with a single piece type. */
export interface PieceRecord {
  /** Games won while this piece was in play. */
  wins: number;
  /** Games lost while this piece was in play. */
  losses: number;
  /** Games tied while this piece was in play. */
  ties: number;
  /** Names of the opponents beaten while this piece was in play. */
  defeatedOpponents: string[];
}

/** The per-piece records, keyed by the piece type's key in {@link pieceTypes}. */
export type DiscoveryRecords = Record<string, PieceRecord>;

/** A game that has finished, ready to be folded into the records. */
export interface FinishedGame {
  /**
   * The piece types that were in play. A piece counts regardless of which
   * player had it, so asymmetrical variants still credit both sides' pieces.
   */
  pieces: Iterable<PieceType>;
  outcome: GameOutcome;
  /** The opponent's name, recorded when the player wins. */
  opponentName: string;
}

/** The totals shown on the home screen and the discoveries page. */
export interface DiscoverySummary {
  discovered: number;
  discoveredPawns: number;
  discoveredKings: number;
  wonWith: number;
  wonWithPawns: number;
  wonWithKings: number;
}

/** Maps each piece type back to its key in {@link pieceTypes}. */
const keyByType = new Map<PieceType, string>(
  Object.entries(pieceTypes).map(([key, type]) => [type, key]),
);

/** The pawn variants, including the classic pawn. */
const pawnKeys = new Set(
  Object.entries(pieceTypes)
    .filter(([, type]) => type.promotesLikePawn === true)
    .map(([key]) => key),
);

/** The king variants, including the classic king. */
const kingKeys = new Set(
  Object.entries(pieceTypes)
    .filter(([, type]) => type.royal === true)
    .map(([key]) => key),
);

function emptyRecord(): PieceRecord {
  return { wins: 0, losses: 0, ties: 0, defeatedOpponents: [] };
}

/** Whether a record represents at least one finished game. */
export function isDiscovered(
  record: PieceRecord | undefined,
): record is PieceRecord {
  return (
    record !== undefined && record.wins + record.losses + record.ties > 0
  );
}

/** The local storage, or `null` when it is unavailable (private mode, tests). */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadDiscoveries(): DiscoveryRecords {
  const store = storage();
  if (!store) return {};
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveDiscoveries(records: DiscoveryRecords): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Discoveries are best-effort; a full or blocked store must not break play.
  }
}

/** Folds a finished game into `records`, returning the updated records. */
export function applyGame(
  records: DiscoveryRecords,
  game: FinishedGame,
): DiscoveryRecords {
  const updated: DiscoveryRecords = { ...records };
  for (const type of game.pieces) {
    const key = keyByType.get(type);
    if (key === undefined) continue;

    const existing = updated[key] ?? emptyRecord();
    const record: PieceRecord = {
      wins: existing.wins,
      losses: existing.losses,
      ties: existing.ties,
      defeatedOpponents: [...existing.defeatedOpponents],
    };

    if (game.outcome === "win") {
      record.wins++;
      if (!record.defeatedOpponents.includes(game.opponentName)) {
        record.defeatedOpponents.push(game.opponentName);
      }
    } else if (game.outcome === "loss") {
      record.losses++;
    } else {
      record.ties++;
    }

    updated[key] = record;
  }
  return updated;
}

/** Records a finished game in local storage and returns the updated records. */
export function recordGame(game: FinishedGame): DiscoveryRecords {
  const updated = applyGame(loadDiscoveries(), game);
  saveDiscoveries(updated);
  return updated;
}

export function summarize(records: DiscoveryRecords): DiscoverySummary {
  const summary: DiscoverySummary = {
    discovered: 0,
    discoveredPawns: 0,
    discoveredKings: 0,
    wonWith: 0,
    wonWithPawns: 0,
    wonWithKings: 0,
  };

  for (const key of Object.keys(pieceTypes)) {
    const record = records[key];
    if (!isDiscovered(record)) continue;

    summary.discovered++;
    if (pawnKeys.has(key)) summary.discoveredPawns++;
    if (kingKeys.has(key)) summary.discoveredKings++;

    if (record.wins > 0) {
      summary.wonWith++;
      if (pawnKeys.has(key)) summary.wonWithPawns++;
      if (kingKeys.has(key)) summary.wonWithKings++;
    }
  }

  return summary;
}

/** The sentence describing the player's discoveries. */
export function discoverySummaryText(summary: DiscoverySummary): string {
  return (
    `You have discovered ${summary.discovered} pieces including ` +
    `${summary.discoveredPawns} pawn types and ${summary.discoveredKings} king types. ` +
    `You have won with ${summary.wonWith} pieces, including ` +
    `${summary.wonWithPawns} pawn types and ${summary.wonWithKings} king types.`
  );
}

/** Rebuilds records from parsed storage, discarding anything malformed. */
function sanitize(value: unknown): DiscoveryRecords {
  if (typeof value !== "object" || value === null) return {};
  const records: DiscoveryRecords = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(pieceTypes, key)) continue;
    if (typeof entry !== "object" || entry === null) continue;
    const { wins, losses, ties, defeatedOpponents } = entry as Record<
      string,
      unknown
    >;
    records[key] = {
      wins: toCount(wins),
      losses: toCount(losses),
      ties: toCount(ties),
      defeatedOpponents: Array.isArray(defeatedOpponents)
        ? defeatedOpponents.filter(
            (name): name is string => typeof name === "string",
          )
        : [],
    };
  }
  return records;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}
