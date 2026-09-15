# Adding a piece

Pieces live in `src/pieces`, grouped by flavour:

- `classic.ts` — the six standard pieces.
- `fairy.ts` — single-pattern fairy pieces (wazir, ferz, camel, …).
- `combinations.ts` — pieces that combine two patterns (knook, bing, …).
- `pawns.ts` — the pawn variants that replace the pawn corps.

Each file default-exports an object of `PieceType`s, and `index.ts` merges them
all into the `pieceTypes` map that the rest of the game looks pieces up by. A
piece is "added" once its entry exists in one of those objects.

## 1. Write the movement in Betza notation

A piece's movement is written once, as a Betza string, and both our own move
generation and Fairy-Stockfish are driven from it. `src/pieces/betza.ts` parses
the notation into a `Behavior` (`(piece, state) => SpecialMovement[]`), and
`src/pieces/behavior.ts` combines that with the rest of the piece's definition
(see step 2). There is no separate hand-written behavior to keep in sync.

Fairy-Stockfish supports only a subset of Betza notation; the supported features
are listed in the *Custom pieces* section of `Fairy-Stockfish/src/variants.ini`:

- all base atoms (`W`, `F`, `D`, `N`, `A`, `H`, `L`/`C`, `J`/`Z`, `G`, `K`,
  `R`, `B`, `Q`),
- all directional modifiers (`f`, `b`, `l`, `r`, `s`, `v`, `h`, and pairs such
  as `fs` or `fr`),
- limited and unlimited riders for the `W`/`R`, `F`/`B` and `N` directions
  (`R`, `R3`, `NN`, `W2`, …),
- hoppers and grasshoppers for the `W`/`R` and `F`/`B` directions (`pR`, `gB`,
  `pF3`, …),
- lame leapers (`nN`, `nA`, `nZ`, `nD`).

A piece may only be added when its movement is expressible exactly within that
subset. Do not approximate: a `betza` that is close but not identical to the
intended movement makes the AI disagree with the board, so leave such a piece
unimplemented instead.

Hoppers can be given a maximum range by appending a digit to the atom, e.g.
`pW2` or `pF3`. The digit is the maximum distance from the origin square,
counting the hurdle square — so `pF2` leaps an adjacent piece and lands two
squares away, while `pF3` also allows landing three squares out. A bare `pF` (or
`pF0`) is unlimited, and `gF`/`pF1` is a grasshopper. The prefix combines with
any atom and modality, so `gcK2` is a capture-only jump in all eight directions.

## 2. Add the `PieceType`

Add an entry to the relevant object. The fields, all documented on the
`PieceType` interface in `index.ts`, are:

- `betza` — the movement from step 1. This is the single source of truth for how
  the piece moves.
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

### Rules that Betza cannot express

Some rules are not part of the notation. They are flags on the `PieceType`, and
both our move generation and the engine read them, so they cannot drift apart:

- `mobilityRegion` — the squares the piece may move to, per colour, in
  Fairy-Stockfish's bitboard syntax (e.g. `a* b* c* d*` for the four left
  files). Used by the jumping pawns, which are confined to one half of the
  board.
- `canCastle` — the piece castles with a rook like a king.
- `canEnPassant` — the piece makes a two-square first move and may be captured
  en passant, like a pawn.
- `promotesLikePawn` — the piece promotes on the far rank.

## 3. Register the piece with Fairy-Stockfish

`src/ai/variant.ts` builds the variant definition from the same `PieceType`
fields, so nothing extra is needed for a piece to work as an AI opponent:

- If the `betza` string appears in the `builtInTypes` map, the piece is
  declared with Fairy-Stockfish's built-in type (for example `N` → `knight`,
  `RN` → `chancellor`). `Fairy-Stockfish/src/variants.ini` lists the built-in
  types and their Betza notation.
- Otherwise the piece is emitted automatically as a custom piece
  (`customPiece1 = o:mFA`), so most new pieces need no change to `variant.ts`
  at all. Only add a `builtInTypes` entry when a matching built-in exists.
- `mobilityRegion`, `canCastle`, `canEnPassant` and `promotesLikePawn` become
  the matching `mobilityRegion*`, `castling`, `enPassantTypes` and
  `promotionPawnTypes` options.

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

## 5. Test it against the engine

`npm test` checks every piece type against Fairy-Stockfish: the Betza parser is
compared move for move, and full legal move generation is compared for each
piece as well as for castling, en passant, promotion and mobility regions. New
pieces are covered automatically, since the tests iterate `pieceTypes`. The
tests use the native build in `Fairy-Stockfish/src/stockfish` when it is
present, and the WebAssembly engine from `fairy-stockfish-nnue.wasm` otherwise
(which is what CI uses).

The tests run the TypeScript sources directly, so they need a Node version with
type stripping (22.6 or newer).
