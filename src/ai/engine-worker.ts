import Stockfish from "fairy-stockfish-nnue.wasm/stockfish.js";
import type { StockfishModule } from "fairy-stockfish-nnue.wasm/stockfish.js";

const ENGINE_BASE = `${import.meta.env.BASE_URL}engine/`;

const workerScope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
};

interface CommandMessage {
  type: "command";
  command: string;
}

let enginePromise: Promise<StockfishModule> | null = null;

function getEngine(): Promise<StockfishModule> {
  if (enginePromise === null) {
    enginePromise = Stockfish({
      mainScriptUrlOrBlob: `${ENGINE_BASE}stockfish.js`,
      locateFile: (fileName: string) => `${ENGINE_BASE}${fileName}`,
    }).then((engine) => {
      engine.addMessageListener((line) => {
        workerScope.postMessage({ type: "line", line });
      });
      return engine;
    });
  }
  return enginePromise;
}

workerScope.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as CommandMessage | undefined;
  if (data?.type !== "command") return;

  void getEngine()
    .then((engine) => engine.postMessage(data.command))
    .catch((error: unknown) => {
      enginePromise = null;
      workerScope.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
});
