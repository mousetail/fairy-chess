declare module "fairy-stockfish-nnue.wasm/stockfish.js" {
  export interface StockfishModule {
    postMessage(command: string): void;
    addMessageListener(listener: (line: string) => void): void;
    removeMessageListener(listener: (line: string) => void): void;
    terminate(): void;
  }

  export interface StockfishConfig {
    locateFile?(path: string, prefix: string): string;
    mainScriptUrlOrBlob?: string;
  }

  const factory: (config?: StockfishConfig) => Promise<StockfishModule>;
  export default factory;
}
