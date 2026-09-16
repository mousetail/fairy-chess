/**
 * The address of the matchmaking server for this build, if the build was given
 * one.
 *
 * `import.meta.env` is absent when these modules are loaded outside a bundle,
 * as they are in the tests, so it is asked rather than assumed.
 */
export const matchmakingUrl = import.meta.env?.VITE_MATCHMAKING_URL?.trim();
