/**
 * Declarations the DefinitelyTyped Deno package does not carry.
 *
 * `@types/deno` is generated from the type definitions Deno ships in its binary,
 * but the pieces that are not part of the `Deno` namespace itself are left to
 * other libraries. `import.meta.main` is Deno's own and belongs to no other
 * library, so it is declared here to keep `tsc` in step with `deno task check`.
 *
 * Deno ignores this file: it loads only the modules its entrypoint imports, and
 * `tsconfig.json` — the only thing that lists it — is itself ignored in favour
 * of `deno.json`.
 */

interface ImportMeta {
  /** Whether this module is the program's entrypoint. */
  readonly main: boolean;
}
