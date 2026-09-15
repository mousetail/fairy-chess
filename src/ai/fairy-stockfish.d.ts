declare module "fairy-stockfish-nnue.wasm/stockfish.js" {
  export interface StockfishModule {
    postMessage(command: string): void;
    addMessageListener(listener: (line: string) => void): void;
    removeMessageListener(listener: (line: string) => void): void;
    /** Emscripten's in-memory filesystem, used to load variant configs. */
    FS: {
      writeFile(path: string, data: string): void;
    };
    terminate(): void;
  }

  export interface StockfishConfig {
    locateFile?(path: string, prefix: string): string;
    mainScriptUrlOrBlob?: string;
    /** The compiled wasm module, used when loading the engine outside a browser. */
    wasmBinary?: Uint8Array;
  }

  const factory: (config?: StockfishConfig) => Promise<StockfishModule>;
  export default factory;
}
