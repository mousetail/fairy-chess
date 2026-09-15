import type { ChessGame } from "../chess-game";
import { FairyStockfishEngine } from "./engine";
import { boardStateToFen, resolveUciMove, type ResolvedMove } from "./fen";
import { buildVariantIni, VARIANT_NAME } from "./variant";

export interface AiSettings {
  /** Minimum time, in milliseconds, before the AI plays its move. */
  minTurnTimeMs: number;
  /** Difficulty from 0 (weakest) to 5 (strongest). */
  difficulty: number;
}

/** Maps the 0-5 UI difficulty onto Fairy Stockfish's `Skill Level` (-20..20).
 *
 * The weakest setting (0) matches the skill that old difficulty level 2 used to
 * have (-4); the remaining levels are spread evenly up to the maximum (20),
 * which level 5 keeps.
 */
export function skillLevelForDifficulty(difficulty: number): number {
  const clamped = Math.min(5, Math.max(0, difficulty));
  const weakestSkill = -4;
  const strongestSkill = 20;
  return Math.round(
    weakestSkill + (clamped / 5) * (strongestSkill - weakestSkill),
  );
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

  async chooseMove(
    game: ChessGame,
    fullMoveNumber: number,
  ): Promise<ResolvedMove> {
    try {
      if (!this.configured) {
        await this.engine.setOption(
          "Skill Level",
          skillLevelForDifficulty(this.settings.difficulty),
        );
        // Teach the engine the rules of the pieces on the board before it sees
        // the position, since the variant is fixed for the whole game.
        await this.engine.setVariant(VARIANT_NAME, buildVariantIni(game.state));
        // Only mark the engine as configured once setup has actually
        // succeeded, so a failed attempt is retried on the next move.
        this.configured = true;
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
    } catch (error) {
      console.error("AI player failed to choose a move:", error);
      throw error;
    }
  }

  dispose(): void {
    this.engine.dispose();
  }
}
