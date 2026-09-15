import EngineWorker from "./engine-worker?worker";

interface Waiter {
  predicate: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

interface FileWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

/** How long to wait for the engine to answer `uci` before giving up. */
const STARTUP_TIMEOUT_MS = 30_000;
/** Extra time allowed beyond the requested movetime for the engine to reply. */
const MOVE_TIMEOUT_BUFFER_MS = 10_000;
/** How long to wait for the worker to write a file into the engine filesystem. */
const FILE_WRITE_TIMEOUT_MS = 30_000;

/** Promise-based wrapper around the Fairy Stockfish UCI worker. */
export class FairyStockfishEngine {
  private worker: Worker;
  private waiters = new Set<Waiter>();
  private fileWaiters = new Map<string, FileWaiter>();
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
    const message = data as {
      type?: string;
      line?: string;
      message?: string;
      path?: string;
    };

    if (message.type === "line" && typeof message.line === "string") {
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message.line)) {
          this.resolveWaiter(waiter, message.line);
        }
      }
      return;
    }

    if (message.type === "fileWritten" && typeof message.path === "string") {
      const waiter = this.fileWaiters.get(message.path);
      if (waiter) {
        this.fileWaiters.delete(message.path);
        if (waiter.timeout !== undefined) clearTimeout(waiter.timeout);
        waiter.resolve();
      }
      return;
    }

    if (message.type === "error") {
      this.failure = new Error(
        message.message ?? "Fairy Stockfish failed to start",
      );
      console.error("Fairy Stockfish worker error:", this.failure);
      // Allow a later call to retry from scratch after a failure.
      this.startPromise = null;
      for (const waiter of [...this.waiters]) {
        this.rejectWaiter(waiter, this.failure);
      }
      this.rejectFileWaiters(this.failure);
      for (const listener of [...this.errorListeners])
        listener(this.failure.message);
    }
  }

  private resolveWaiter(waiter: Waiter, line: string): void {
    if (waiter.timeout !== undefined) clearTimeout(waiter.timeout);
    this.waiters.delete(waiter);
    waiter.resolve(line);
  }

  private rejectWaiter(waiter: Waiter, error: Error): void {
    if (waiter.timeout !== undefined) clearTimeout(waiter.timeout);
    this.waiters.delete(waiter);
    waiter.reject(error);
  }

  private rejectFileWaiters(error: Error): void {
    for (const waiter of [...this.fileWaiters.values()]) {
      if (waiter.timeout !== undefined) clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.fileWaiters.clear();
  }

  private send(command: string): void {
    this.worker.postMessage({ type: "command", command });
  }

  private waitForLine(
    predicate: (line: string) => boolean,
    timeoutMs?: number,
  ): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { predicate, resolve, reject };
      this.waiters.add(waiter);
      if (timeoutMs !== undefined) {
        waiter.timeout = setTimeout(() => {
          this.rejectWaiter(
            waiter,
            new Error(
              `Fairy Stockfish did not respond within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }
    });
  }

  private ensureStarted(): Promise<void> {
    if (this.startPromise === null) {
      this.startPromise = (async () => {
        const uciOk = this.waitForLine(
          (line) => line.trim() === "uciok",
          STARTUP_TIMEOUT_MS,
        );
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
    void this.ensureStarted().catch((error: unknown) => {
      console.error("Fairy Stockfish failed to preload:", error);
    });
  }

  async setOption(name: string, value: string | number): Promise<void> {
    await this.ensureStarted();
    this.send(`setoption name ${name} value ${value}`);
  }

  /**
   * Registers a variant defined by `ini` and makes it the active variant.
   *
   * The configuration is written to the engine's in-memory filesystem and
   * loaded through the `VariantPath` option, which is the only way to feed a
   * variant definition to the WebAssembly build.
   */
  async setVariant(name: string, ini: string): Promise<void> {
    await this.ensureStarted();
    const path = "/variants.ini";
    await this.writeFile(path, ini);
    this.send(`setoption name VariantPath value ${path}`);
    this.send(`setoption name UCI_Variant value ${name}`);
  }

  private writeFile(path: string, content: string): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter: FileWaiter = { resolve, reject };
      this.fileWaiters.set(path, waiter);
      waiter.timeout = setTimeout(() => {
        if (this.fileWaiters.delete(path)) {
          reject(
            new Error(
              `Fairy Stockfish did not write ${path} within ${FILE_WRITE_TIMEOUT_MS}ms`,
            ),
          );
        }
      }, FILE_WRITE_TIMEOUT_MS);
      this.worker.postMessage({ type: "writeFile", path, content });
    });
  }

  async bestMove(fen: string, movetimeMs: number): Promise<string> {
    await this.ensureStarted();

    const bestMove = this.waitForLine(
      (line) => line.startsWith("bestmove"),
      Math.max(1, Math.round(movetimeMs)) + MOVE_TIMEOUT_BUFFER_MS,
    );
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
      this.rejectWaiter(waiter, error);
    }
    this.rejectFileWaiters(error);
    this.errorListeners.clear();
  }
}
