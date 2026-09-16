/// <reference types="vite/client" />

/**
 * The variables a build reads from its `.env`.
 *
 * Vite type-checks `import.meta.env` loosely unless a variable is named here, so
 * this is what makes `VITE_MATCHMAKING_URL` a `string | undefined` rather than
 * `any` at the one place that reads it, `src/online/config.ts`.
 */
interface ImportMetaEnv {
  /** The matchmaking server this build talks to. See `src/online/config.ts`. */
  readonly VITE_MATCHMAKING_URL?: string;
}
