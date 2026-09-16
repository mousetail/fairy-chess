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
} satisfies Record<string, PieceType>;

export default kingPieces;
