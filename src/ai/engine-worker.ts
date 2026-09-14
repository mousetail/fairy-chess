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

interface WriteFileMessage {
  type: "writeFile";
  path: string;
  content: string;
}

type IncomingMessage = CommandMessage | WriteFileMessage;

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
  const data = event.data as IncomingMessage | undefined;
  if (data?.type !== "command" && data?.type !== "writeFile") return;

  void getEngine()
    .then((engine) => {
      if (data.type === "writeFile") {
        engine.FS.writeFile(data.path, data.content);
        workerScope.postMessage({ type: "fileWritten", path: data.path });
      } else {
        engine.postMessage(data.command);
      }
    })
    .catch((error: unknown) => {
      enginePromise = null;
      workerScope.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
});
