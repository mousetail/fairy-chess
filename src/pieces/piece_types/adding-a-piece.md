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

Reach for a hand-written behavior only when the pattern is irregular; the pylon
in `fairy.ts` and the wall and pseudocheckers in `pawns.ts` are examples.

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

A piece whose movement depends on which half of the board it stands on can be
restricted with a `mobilityRegion`, a per-colour set of squares it may move to.
Add an entry to the `mobilityRegions` map in `variant.ts`, written in
Fairy-Stockfish's bitboard syntax (e.g. `a* b* c* d*` for the four left files);
the jumping pawns are the current examples.

Fairy-Stockfish supports only a subset of Betza notation; the supported
features are listed in the *Custom pieces* section of `variants.ini` (base
atoms, directional modifiers, sliders/riders, W/R and F/B hoppers, and the lame
leapers `nN`, `nA`, `nZ`, `nD`). A piece may only be added when its movement is
expressible exactly within that subset. Do not approximate: a `betza` that is
close but not identical to `behavior` makes the AI disagree with the board, so
leave such a piece unimplemented instead.

Hoppers can also be given a maximum range by appending a digit to the atom, e.g.
`pW2` or `pF3`. The digit is the maximum distance from the origin square,
counting the hurdle square — so `pF2` leaps an adjacent piece and lands two
squares away, while `pF3` also allows landing three squares out. A bare `pF` (or
`pF0`) is unlimited, and `gF`/`pF1` is a grasshopper. The prefix combines with
any atom and modality, so `gcK2` is a capture-only jump in all eight directions.

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
- `pawnSplitRule(name, left, right)` converts the corps, choosing between two
  variants by which half of the board each pawn starts on.
- `pawnDoubleRowRule(name, to)` converts the corps and adds a second row in
  front of it, for a piece whose copies work together when stacked.

Add the new piece to `replacementRules` if it should be able to enter a game.