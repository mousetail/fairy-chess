import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";

const ENGINE_PACKAGE = "fairy-stockfish-nnue.wasm";
const ENGINE_FILES = ["stockfish.js", "stockfish.wasm", "stockfish.worker.js"];
const ENGINE_ROUTE = "/engine/";

/**
 * Locates the installed engine package by walking up from the given roots
 * looking for `node_modules/<package>`. We deliberately avoid
 * `require.resolve` here because it behaves inconsistently across Node/npm
 * versions and Vite's bundled-config loader.
 */
function findEngineDirectory(roots: string[]): string {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: string) => {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
  };

  for (const root of roots) {
    let directory = path.resolve(root);
    for (;;) {
      addCandidate(path.join(directory, "node_modules", ENGINE_PACKAGE));
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "stockfish.js"))) return candidate;
  }

  throw new Error(
    `Could not find the "${ENGINE_PACKAGE}" package in node_modules. ` +
      `Run "npm install" before building.`,
  );
}

/**
 * Fairy Stockfish is an Emscripten build that spawns its own pthread workers
 * from sibling files and loads its wasm module by URL. Those files therefore
 * have to be served untouched (no bundler transform), so we expose them from
 * node_modules at `/engine/*` in dev and copy them into the build output.
 */
function fairyStockfishAssets(): Plugin {
  let directory: string | null = null;

  const engineDirectory = (root: string): string => {
    if (directory === null) {
      directory = findEngineDirectory([root, process.cwd()]);
    }
    return directory;
  };

  const serveEngineFile: Connect.NextHandleFunction = (request, response, next) => {
    const requestPath = (request.url ?? "").split("?")[0];
    const fileName = path.basename(requestPath);
    if (!requestPath.startsWith(ENGINE_ROUTE) || !ENGINE_FILES.includes(fileName)) {
      next();
      return;
    }

    response.setHeader(
      "Content-Type",
      fileName.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    );
    fs.createReadStream(path.join(engineDirectory(process.cwd()), fileName)).pipe(
      response,
    );
  };

  return {
    name: "fairy-stockfish-assets",
    configResolved(config) {
      // Resolve eagerly so a missing dependency fails with a clear message.
      engineDirectory(config.root);
    },
    configureServer(server) {
      server.middlewares.use(serveEngineFile);
    },
    generateBundle() {
      const root = engineDirectory(process.cwd());
      for (const fileName of ENGINE_FILES) {
        this.emitFile({
          type: "asset",
          fileName: `engine/${fileName}`,
          source: fs.readFileSync(path.join(root, fileName)),
        });
      }
    },
  };
}

// Fairy Stockfish uses WebAssembly threads, which require SharedArrayBuffer and
// therefore a cross-origin isolated document. These headers make that work in
// dev and preview. Static hosts that cannot send headers (e.g. GitHub Pages) are
// handled client-side by public/coi-serviceworker.js instead.
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [fairyStockfishAssets()],
  server: { headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders },
});
