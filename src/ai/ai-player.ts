import type { ChessGame } from "../chess-game";
import { FairyStockfishEngine } from "./engine";
import { boardStateToFen, resolveUciMove, type ResolvedMove } from "./fen";

export interface AiSettings {
  /** Minimum time, in milliseconds, before the AI plays its move. */
  minTurnTimeMs: number;
  /** Difficulty from 0 (weakest) to 5 (strongest). */
  difficulty: number;
}

/** Maps the 0-5 UI difficulty onto Fairy Stockfish's `Skill Level` (-20..20). */
export function skillLevelForDifficulty(difficulty: number): number {
  const clamped = Math.min(5, Math.max(0, difficulty));
  return Math.round((clamped / 5) * 40) - 20;
}

/** Plays a single colour using a Fairy Stockfish engine running in a web worker. */
export class AiPlayer {
  private engine: FairyStockfishEngine;
  private settings: AiSettings;
  private configured = false;

  constructor(settings: AiSettings) {
    this.settings = settings;
    this.engine = new FairyStockfishEngine();
  }

  preload(): void {
    this.engine.preload();
  }

  onError(listener: (message: string) => void): void {
    this.engine.onError(listener);
  }

  async chooseMove(game: ChessGame, fullMoveNumber: number): Promise<ResolvedMove> {
    if (!this.configured) {
      this.configured = true;
      await this.engine.setOption(
        "Skill Level",
        skillLevelForDifficulty(this.settings.difficulty),
      );
    }

    const fen = boardStateToFen(game.state, fullMoveNumber);
    const movetimeMs = Math.max(1, this.settings.minTurnTimeMs);
    const bestMove = this.engine.bestMove(fen, movetimeMs);
    // Keep the AI from replying instantly so the game feels more natural.
    const minimumDelay = new Promise<void>((resolve) =>
      setTimeout(resolve, this.settings.minTurnTimeMs),
    );

    const uci = await bestMove;
    await minimumDelay;
    return resolveUciMove(game, uci);
  }

  dispose(): void {
    this.engine.dispose();
  }
}
