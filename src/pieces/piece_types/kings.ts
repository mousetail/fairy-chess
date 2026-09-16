import { type PieceType } from "./index.ts";
import { getPieceImageAsync } from "../utils.ts";

/**
 * The king variants: pieces that replace the king on the board rather than a
 * single specialist. They work unlike the other categories, because the rest of
 * the game treats the king specially:
 *
 * - they are royal, so our move generation never lets them move into check, and
 * - they always carry the `k` symbol, and `ai/variant.ts` declares whichever one
 *   is in play as the engine's king, overriding the default king movement.
 *
 * Like the classic king they may never be promoted to.
 */
const kingPieces = {
  overlord: {
    symbol: "k",
    betza: "R3",
    royal: true,
    promotionAbility: "deny",
    image: getPieceImageAsync("medieval", "overlord"),
    value: 3,
    displayName: "Overlord",
    description: "Moves up to three squares horizontally or vertically.",
    diagram: {
      size: 7,
      rows: [
        "...x...",
        "...x...",
        "...x...",
        "xxxoxxx",
        "...x...",
        "...x...",
        "...x...",
      ],
    },
  },
  paladin: {
    symbol: "k",
    betza: "B3",
    royal: true,
    promotionAbility: "deny",
    image: getPieceImageAsync("medieval", "paladin"),
    value: 2,
    displayName: "Paladin",
    description: "Moves up to three squares diagonally.",
    diagram: {
      size: 7,
      rows: [
        "x.....x",
        ".x...x.",
        "..x.x..",
        "...o...",
        "..x.x..",
        ".x...x.",
        "x.....x",
      ],
    },
  },
  sun: {
    symbol: "k",
    betza: "WFND",
    royal: true,
    promotionAbility: "deny",
    // The wazir, ferz, dabbaba and knight leaps together reach every square of
    // a 2x3 rectangle from any other, so inside its palace the Sun may jump
    // anywhere. The region keeps it in the rectangle it starts in: the three
    // files around the king on its back rank and the rank in front of it.
    mobilityRegion: {
      white: "d1 e1 f1 d2 e2 f2",
      black: "d8 e8 f8 d7 e7 f7",
    },
    image: getPieceImageAsync("helios", "sun"),
    value: 8,
    displayName: "Sun",
    description:
      "Confined to the 2x3 rectangle it starts in; jumps to any square of it.",
    diagram: {
      size: 5,
      rows: [".....", ".xxx.", ".xox.", ".....", "....."],
    },
  },
} satisfies Record<string, PieceType>;

export default kingPieces;
