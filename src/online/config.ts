/**
 * Where the matchmaking server lives.
 *
 * It is deliberately hosted on its own domain rather than alongside the site,
 * so its address cannot be derived from `location` the way a same-origin API
 * could be. `VITE_MATCHMAKING_URL` in the `.env` file is what a deployment
 * sets; the values below are the two well-known ones, so a checkout runs
 * against a local server in development and the live one in a build without
 * any configuration at all.
 */

/** The matchmaking server the live site talks to. */
const productionUrl = "wss://fairy-chess-matchmaking.mousetail.nl/ws";

/** The server `deno task start` in `matchmaking/` listens on. */
const developmentUrl = "ws://localhost:8000/ws";

/** Picks the matchmaking URL for a build, given what the environment says. */
export function resolveMatchmakingUrl(
  configured: string | undefined,
  development: boolean,
): string {
  if (configured !== undefined && configured.trim() !== "") {
    return configured.trim();
  }
  return development ? developmentUrl : productionUrl;
}

/**
 * The address of the matchmaking server for this build.
 *
 * `import.meta.env` is absent when these modules are loaded outside a bundle,
 * which is why the fallback is spelled out rather than assumed.
 */
export const matchmakingUrl = resolveMatchmakingUrl(
  import.meta.env?.VITE_MATCHMAKING_URL,
  import.meta.env?.DEV === true,
);
