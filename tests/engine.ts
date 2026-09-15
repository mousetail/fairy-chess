import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stockfish from "fairy-stockfish-nnue.wasm/stockfish.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");

/** A running Fairy-Stockfish, used as the reference for the move generation. */
export interface Engine {
  /**
   * The moves of a position, as `e2e4` (with a promotion letter when relevant),
   * sorted. `variantIni` defines the variant, which is registered under
   * `variantName`; each name must be unique per engine.
   */
  perft(variantIni: string, variantName: string, fen: string): Promise<string[]>;
  close(): Promise<void>;
}

const MOVE_PATTERN = /^([a-h][1-8][a-h][1-8][a-z]?):/;

function parsePerft(output: string): string[] {
  const moves: string[] = [];
  for (const line of output.split("\n")) {
    const match = MOVE_PATTERN.exec(line.trim());
    if (match) moves.push(match[1]);
  }
  return [...new Set(moves)].sort();
}

/**
 * Locates the installed engine package by walking up from the project looking
 * for `node_modules/fairy-stockfish-nnue.wasm`.
 */
function findEnginePackage(): string {
  let directory = PROJECT_ROOT;
  for (;;) {
    const candidate = path.join(
      directory,
      "node_modules",
      "fairy-stockfish-nnue.wasm",
    );
    if (fs.existsSync(path.join(candidate, "stockfish.js"))) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(
        "Could not find fairy-stockfish-nnue.wasm in node_modules; run npm install.",
      );
    }
    directory = parent;
  }
}

async function createWasmEngine(): Promise<Engine> {
  const enginePackage = findEnginePackage();
  const wasmBinary = fs.readFileSync(path.join(enginePackage, "stockfish.wasm"));
  const engine = await Stockfish({ wasmBinary });
  const configured = new Map<string, string>();
  await new Promise<void>((resolve) => {
    const listener = (line: string) => {
      if (line.trim() === "uciok") {
        engine.removeMessageListener(listener);
        resolve();
      }
    };
    engine.addMessageListener(listener);
    engine.postMessage("uci");
  });

  return {
    async perft(variantIni, variantName, fen) {
      if (configured.get(variantName) !== variantIni) {
        const iniPath = `/${variantName}.ini`;
        engine.FS.writeFile(iniPath, variantIni);
        engine.postMessage(`setoption name VariantPath value ${iniPath}`);
        engine.postMessage(`setoption name UCI_Variant value ${variantName}`);
        configured.set(variantName, variantIni);
      }
      const lines: string[] = [];
      await new Promise<void>((resolve) => {
        const listener = (line: string) => {
          lines.push(line);
          if (line.startsWith("Nodes searched")) {
            engine.removeMessageListener(listener);
            resolve();
          }
        };
        engine.addMessageListener(listener);
        engine.postMessage(`position fen ${fen}`);
        engine.postMessage("go perft 1");
      });
      return parsePerft(lines.join("\n"));
    },
    async close() {
      engine.terminate();
    },
  };
}

/** A native build, driven over stdin/stdout like any UCI engine. */
function createNativeEngine(binary: string): Engine {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
  child.stdout.setEncoding("utf8");

  const listeners = new Set<(line: string) => void>();
  let buffer = "";
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      for (const listener of [...listeners]) listener(line);
    }
  });

  const send = (command: string): void => {
    child.stdin.write(`${command}\n`);
  };

  /** Collects output lines until `until` matches, then resolves with them. */
  const waitForLines = (until: (line: string) => boolean): Promise<string[]> =>
    new Promise((resolve) => {
      const lines: string[] = [];
      const listener = (line: string) => {
        lines.push(line);
        if (until(line)) {
          listeners.delete(listener);
          resolve(lines);
        }
      };
      listeners.add(listener);
    });

  const ready = waitForLines((line) => line === "uciok");
  send("uci");
  const configured = new Map<string, string>();

  return {
    async perft(variantIni, variantName, fen) {
      await ready;
      const done = waitForLines((line) => line.startsWith("Nodes searched"));
      if (configured.get(variantName) !== variantIni) {
        const iniPath = path.join(
          os.tmpdir(),
          `fairy-chess-test-${process.pid}-${variantName}.ini`,
        );
        fs.writeFileSync(iniPath, variantIni);
        send(`setoption name VariantPath value ${iniPath}`);
        send(`setoption name UCI_Variant value ${variantName}`);
        configured.set(variantName, variantIni);
      }
      send(`position fen ${fen}`);
      send("go perft 1");
      return parsePerft((await done).join("\n"));
    },
    async close() {
      child.kill();
    },
  };
}

/**
 * Starts the reference engine. A native build is used when one is available
 * (it is much faster), otherwise the WebAssembly build from the npm package is
 * used, which is what CI has.
 */
export async function createEngine(): Promise<Engine> {
  const binary =
    process.env.FAIRY_STOCKFISH_BIN ??
    path.join(PROJECT_ROOT, "Fairy-Stockfish", "src", "stockfish");
  if (fs.existsSync(binary)) return createNativeEngine(binary);
  return createWasmEngine();
}
