# Adding a piece

Pieces live in `src/pieces`, grouped by flavour:

- `classic.ts` — the six standard pieces.
- `fairy.ts` — single-pattern fairy pieces (wazir, ferz, camel, …).
- `combinations.ts` — pieces that combine two patterns (knook, bing, …).

Each file default-exports an object of `PieceType`s, and `index.ts` merges them
all into the `pieceTypes` map that the rest of the game looks pieces up by. A
piece is "added" once its entry exists in one of those objects.

## 1. Write the movement

Movement is a `Behavior`: `(piece, state) => SpecialMovement[]`, returning one
entry per destination with `type: "move"` (quiet) or `type: "capture"`. Most
pieces can be built from the helpers in `utils.ts`:

- `jumpBehavior(directions)` — leap a fixed offset, ignoring blockers.
- `moveBehavior(directions)` — slide until blocked, capturing the first enemy.
- `combine(...behaviors)` — the union of several behaviors (used in
  `combinations.ts`).
- `normalizeColor(inner)` — flips the board for black so a behavior can be
  written from white's point of view (used by the pawn).

Reach for a hand-written behavior only when the pattern is irregular; the wall,
pylon and pseudocheckers in `fairy.ts` are examples.

## 2. Add the `PieceType`

Add an entry to the relevant object. The fields, all documented on the
`PieceType` interface in `index.ts`, are:

- `behavior` — the movement from step 1.
- `betza` — the movement in Betza notation, used to describe the piece to the
  engine (see below).
- `symbol` / `fallbackSymbols` — the preferred one-letter symbol and the
  letters to fall back on when it is already taken.
- `image` / `value` / `displayName` / `aliases` / `description` — presentation:
  artwork, approximate pawn value, and the text shown in the piece info bar.
- `diagram` — the hand-drawn movement picture; see `diagram.ts` for the tile
  characters (`.` empty, `o` the piece, `x` move, `c` capture-only).
- `promotionAbility` — `"deny"` to keep the piece out of promotion options,
  `"priority"` to make it the *only* promotion target when it is in play.

Artwork is pulled from `src/images` with `getPieceImageAsync(category, name)`;
reuse an existing image rather than adding one unless the piece really needs
its own.

## 3. Register the piece with Fairy-Stockfish

The engine is told the rules of exactly the pieces in play, so nothing extra is
needed for a piece to work as an AI opponent — but the `betza` string must
describe the same movement as `behavior`, or the AI will disagree with the
board.

`src/ai/variant.ts` builds the variant definition:

- If the `betza` string appears in the `builtInTypes` map, the piece is
  declared with Fairy-Stockfish's built-in type (for example `N` → `knight`,
  `RN` → `chancellor`). `Fairy-Stockfish/src/variants.ini` lists the built-in
  types and their Betza notation.
- Otherwise the piece is emitted automatically as a custom piece
  (`customPiece1 = o:mFA`), so most new pieces need no change to `variant.ts`
  at all. Only add a `builtInTypes` entry when a matching built-in exists.

Fairy-Stockfish supports only a subset of Betza notation; the supported
features are listed in the *Custom pieces* section of `variants.ini` (base
atoms, directional modifiers, sliders/riders, W/R and F/B hoppers, and the lame
leapers `nN`, `nA`, `nZ`, `nD`). If a movement cannot be expressed within that
subset, approximate it and say so in the piece's `description` — for example
Fairy-Stockfish cannot require the piece a pseudocheckers jump clears to be
adjacent, so its Betza is a diagonal grasshopper (`mFgB`), which jumps the first
piece on the diagonal however far away it stands.

The engine is taught the rules through a generated `variants.ini` written into
the WebAssembly filesystem and loaded via the `VariantPath` option; see
`src/ai/engine.ts` and `src/ai/ai-player.ts`. Symbols are resolved per game by
`resolveSymbols` in `chess-game.ts`, so two pieces may share a preferred symbol
as long as one of them lists a free fallback.

## 4. Optional: let chaos introduce it

`src/replacement-rules.ts` lists the swaps the chaos slider may apply.

- `rule(name, from, to)` swaps a single piece (respecting `maxCopiesPerPiece`).
- `pawnRule(name, file, to)` swaps one specific pawn.
- `pawnSquadRule(name, to)` converts a colour's whole pawn corps, for pieces
  that arrive as a squad rather than a single specialist.

Add the new piece to `replacementRules` if it should be able to enter a game.