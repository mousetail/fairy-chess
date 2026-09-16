import { type PieceType } from "./index.ts";
import { getPieceImageAsync } from "../utils.ts";

/**
 * The pawn variants: pieces that replace the pawn corps rather than a single
 * specialist. They all promote on the far rank, so `promotesLikePawn` is set
 * and `variant.ts` lists them as promotion pawns for the engine.
 *
 * Symbols are free letters, except the commoner which uses the Fairy-Stockfish
 * letter for its namesake:
 *   antipawn        = d
 *   commoner        = m
 *   jumping pawn    = j (left) and l (right)
 *   torpedo         = t
 *   sentry          = s
 *   wall            = x
 *   pseudocheckers  = o
 *
 * The two jumping pawns are the same piece split by the half of the board it
 * starts on, so each has a fixed diagonal towards the centre; their
 * `mobilityRegion` keeps each variant on its own side of the centre line.
 */
const pawnPieces = {
  antipawn: {
    symbol: "d",
    betza: "mfFcfW",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "duke"),
    value: 1,
    displayName: "Antipawn",
    description:
      "Moves diagonally forward; captures straight forward. Promotes on the last rank.",
    diagram: {
      size: 5,
      rows: [".....", ".xcx.", "..o..", ".....", "....."],
    },
  },
  commoner: {
    symbol: "m",
    betza: "mfW2cfF2",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "commoner"),
    value: 1,
    displayName: "Commoner",
    description:
      "Moves up to two squares forward; captures up to two squares diagonally forward.",
    diagram: {
      size: 5,
      rows: ["c.x.c", ".cxc.", "..o..", ".....", "....."],
    },
  },
  jumpingPawnLeft: {
    symbol: "j",
    betza: "fWflF",
    promotionAbility: "deny",
    promotesLikePawn: true,
    mobilityRegion: { white: "a* b* c* d*", black: "e* f* g* h*" },
    image: getPieceImageAsync("medieval", "guardian"),
    value: 1,
    displayName: "Jumping Pawn",
    description:
      "Moves and captures forward or diagonally towards the centre;",
    diagram: {
      size: 5,
      rows: [".....", "..xx.", "..o..", ".....", "....."],
    },
  },
  jumpingPawnRight: {
    symbol: "l",
    betza: "fWfrF",
    promotionAbility: "deny",
    promotesLikePawn: true,
    mobilityRegion: { white: "e* f* g* h*", black: "a* b* c* d*" },
    image: getPieceImageAsync("medieval", "guardian"),
    value: 1,
    displayName: "Jumping Pawn",
    description:
      "Moves forward or diagonally towards the centre;",
    diagram: {
      size: 5,
      rows: [".....", ".xx..", "..o..", ".....", "....."],
    },
  },
  spear: {
    symbol: "t",
    betza: "fcW2fW",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "spear"),
    value: 1,
    displayName: "Spear",
    description: "Moves one space forward, captures up to two.",
    diagram: {
      size: 5,
      rows: ["..c..", "..x..", "..o..", ".....", "....."],
    },
  },
  sentry: {
    symbol: "s",
    betza: "mfWcsWbcR",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "sentry"),
    value: 1,
    displayName: "Sentry",
    description: "Moves one square forward; captures one square sideways or backwards.",
    diagram: {
      size: 5,
      rows: [".....", "..x..", ".coc.", "..c..", "..c.."],
    },
  },
  wall: {
    symbol: "x",
    betza: "cK",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("medieval", "fortress"),
    value: 2,
    displayName: "Wall",
    description: "Cannot move; captures any adjacent enemy piece.",
    diagram: {
      size: 5,
      rows: [".....", ".ccc.", ".coc.", ".ccc.", "....."],
    },
  },
  pseudocheckers: {
    symbol: "o",
    betza: "mFgF2gcK2",
    promotionAbility: "deny",
    promotesLikePawn: true,
    image: getPieceImageAsync("geometry", "circle"),
    value: 5,
    displayName: "Pseudocheckers Tile",
    aliases: ["Checkers Tile"],
    description:
      "Steps one square diagonally and jumps an adjacent piece to move or capture just beyond it; also captures just beyond an adjacent piece sideways or forwards.",
    diagram: {
      size: 5,
      rows: ["x.c.x", ".x.x.", "c.o.c", ".x.x.", "x.c.x"],
    },
  },
} satisfies Record<string, PieceType>;

export default pawnPieces;
