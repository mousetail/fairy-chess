import EngineWorker from "./engine-worker?worker";

interface Waiter {
  predicate: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
}

/** Promise-based wrapper around the Fairy Stockfish UCI worker. */
export class FairyStockfishEngine {
  private worker: Worker;
  private waiters = new Set<Waiter>();
  private errorListeners = new Set<(message: string) => void>();
  private failure: Error | null = null;
  private startPromise: Promise<void> | null = null;

  constructor() {
    this.worker = new EngineWorker();
    this.worker.addEventListener("message", (event: MessageEvent) => {
      this.onMessage(event.data);
    });
  }

  private onMessage(data: unknown): void {
    if (data === null || typeof data !== "object") return;
    const message = data as { type?: string; line?: string; message?: string };

    if (message.type === "line" && typeof message.line === "string") {
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message.line)) {
          this.waiters.delete(waiter);
          waiter.resolve(message.line);
        }
      }
      return;
    }

    if (message.type === "error") {
      this.failure = new Error(message.message ?? "Fairy Stockfish failed to start");
      for (const waiter of [...this.waiters]) {
        this.waiters.delete(waiter);
        waiter.reject(this.failure);
      }
      for (const listener of [...this.errorListeners]) listener(this.failure.message);
    }
  }

  private send(command: string): void {
    this.worker.postMessage({ type: "command", command });
  }

  private waitForLine(predicate: (line: string) => boolean): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiters.add({ predicate, resolve, reject });
    });
  }

  private ensureStarted(): Promise<void> {
    if (this.startPromise === null) {
      this.startPromise = (async () => {
        const uciOk = this.waitForLine((line) => line.trim() === "uciok");
        this.send("uci");
        await uciOk;
      })();
      // Allow a later call to retry after a startup failure.
      this.startPromise.catch(() => {
        this.startPromise = null;
      });
    }
    return this.startPromise;
  }

  onError(listener: (message: string) => void): void {
    this.errorListeners.add(listener);
  }

  preload(): void {
    void this.ensureStarted().catch(() => {});
  }

  async setOption(name: string, value: string | number): Promise<void> {
    await this.ensureStarted();
    this.send(`setoption name ${name} value ${value}`);
  }

  async bestMove(fen: string, movetimeMs: number): Promise<string> {
    await this.ensureStarted();

    const bestMove = this.waitForLine((line) => line.startsWith("bestmove"));
    this.send("ucinewgame");
    this.send(`position fen ${fen}`);
    this.send(`go movetime ${Math.max(1, Math.round(movetimeMs))}`);

    const line = await bestMove;
    const move = line.split(/\s+/)[1];
    if (!move || move === "(none)") {
      throw new Error("Fairy Stockfish returned no move");
    }
    return move;
  }

  dispose(): void {
    this.worker.terminate();
    const error = new Error("Fairy Stockfish engine was disposed");
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter.reject(error);
    }
    this.errorListeners.clear();
  }
}
