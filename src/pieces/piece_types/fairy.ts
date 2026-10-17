import { type PieceType } from "./index.ts";
import { getPieceImageAsync } from "../utils.ts";

/**
 * The basic fairy chess pieces. The leapers move a fixed distance and jump, so
 * they can never be blocked; the riders slide along their directions.
 *
 * Symbols follow the Fairy-Stockfish letters for their movement patterns where
 * one exists, and are otherwise free letters:
 *   wazir          = w
 *   ferz           = f
 *   camel          = c (chancellor also uses c; the per-game symbol map disambiguates)
 *   zebra          = z
 *   unicorn        = u
 *   pylon          = y
 *
 * The wazir and ferz are promotion priorities: a game that fields one of them
 * offers only that piece (or, when both are in play, the two of them) as
 * promotion targets.
 *
 * The last five pieces use Betza features Fairy-Stockfish cannot express, so
 * they are marked `onlineOnly` and never enter a game played against the AI:
 *   magician       = xxU   (swap with any friendly piece)
 *   chimpanzee     = mU    (jump to any empty square)
 *   snake          = wB    (bishop that bounces off the walls)
 *   spider         = d(anchor)R (rook that drops anchors as it moves)
 *   anchor         = T     (dropped by the spider; destroyed at its owner's turn)
 *
 * The replace modifier is written `x` rather than the suggested `r`, because
 * `r` is already the "right" direction modifier.
 */
const fairyPieces = {
  wazir: {
    symbol: "w",
    betza: "W",
    promotionAbility: "priority",
    image: getPieceImageAsync("fantasy", "cyclops"),
    value: 2,
    displayName: "Wazir",
    description: "Moves one square horizontally or vertically.",
    diagram: {
      size: 5,
      rows: [".....", "..x..", ".xox.", "..x..", "....."],
    },
  },
  ferz: {
    symbol: "f",
    betza: "F",
    promotionAbility: "priority",
    image: getPieceImageAsync("fantasy", "archon"),
    value: 2,
    displayName: "Ferz",
    aliases: ["Fers"],
    description: "Moves one square diagonally.",
    diagram: {
      size: 5,
      rows: [".....", ".x.x.", "..o..", ".x.x.", "....."],
    },
  },
  camel: {
    symbol: "c",
    betza: "C",
    fallbackSymbols: ["m"],
    image: getPieceImageAsync("nature", "kangaroo"),
    value: 3,
    displayName: "Camel",
    description: "Leaps one square then three, over other pieces.",
    promotionAbility: "always",
    diagram: {
      size: 7,
      rows: [
        "..x.x..",
        ".......",
        "x.....x",
        "...o...",
        "x.....x",
        ".......",
        "..x.x..",
      ],
    },
  },
  zebra: {
    symbol: "z",
    betza: "Z",
    image: getPieceImageAsync("nature", "zebra"),
    value: 3,
    displayName: "Zebra",
    description: "Leaps two squares then three, over other pieces.",
    diagram: {
      size: 7,
      rows: [
        ".x...x.",
        "x.....x",
        ".......",
        "...o...",
        ".......",
        "x.....x",
        ".x...x.",
      ],
    },
  },
  unicorn: {
    symbol: "u",
    betza: "NN",
    image: getPieceImageAsync("fantasy", "unicorn"),
    value: 9,
    displayName: "Unicorn",
    aliases: ["Nightrider"],
    description: "Slides any number of squares along a knight's line.",
    diagram: {
      size: 7,
      rows: [
        ".......",
        "..x.x..",
        ".x...x.",
        "...o...",
        ".x...x.",
        "..x.x..",
        ".......",
      ],
    },
  },
  pylon: {
    symbol: "y",
    betza: "mQcfF",
    image: getPieceImageAsync("fantasy", "pylon"),
    value: 3,
    displayName: "Pylon",
    description: "Slides like a queen; captures diagonally forward.",
    diagram: {
      size: 5,
      rows: ["x.x.x", ".cxc.", "xxoxx", ".xxx.", "x.x.x"],
    },
    promotionAbility: "always",
  },
  magician: {
    symbol: "g",
    betza: "xxU",
    onlineOnly: true,
    fallbackSymbols: ["m", "a", "e"],
    image: getPieceImageAsync("fantasy", "mage"),
    value: 5,
    displayName: "Magician",
    description:
      "Drag over a friendly piece to swap spaces.",
    diagram: {
      size: 5,
      rows: ["xxxxx", "xxxxx", "xxoxx", "xxxxx", "xxxxx"],
    },
  },
  chimpanzee: {
    symbol: "h",
    betza: "mU",
    onlineOnly: true,
    fallbackSymbols: ["i", "o", "n"],
    image: getPieceImageAsync("nature", "chimpanzee"),
    value: 4,
    displayName: "Chimpanzee",
    description: "Moves to any empty square on the board.",
    diagram: {
      size: 5,
      rows: ["xExxx", "xxxxx", "xxoxx", "xxxxx", "xxExx"],
    },
  },
  snake: {
    symbol: "s",
    betza: "wB",
    onlineOnly: true,
    fallbackSymbols: ["n", "k", "v"],
    image: getPieceImageAsync("nature", "snake"),
    value: 4,
    displayName: "Snake",
    description: "Slides diagonally, bouncing off the board edges.",
    diagram: {
      size: 5,
      rows: [".x.x.", "x.x..", ".o...", "x.x..", ".x.x."],
    },
  },
  spider: {
    symbol: "p",
    betza: "d(anchor)R",
    onlineOnly: true,
    fallbackSymbols: ["r", "d", "t"],
    image: getPieceImageAsync("nature", "spider"),
    value: 5,
    displayName: "Spider",
    description:
      "Moves like a rook, leaving a trail of anchors",
    diagram: {
      size: 5,
      rows: ["..x..", "..x..", "xxoxx", "..x..", "..x.."],
    },
  },
  anchor: {
    symbol: "a",
    betza: "T",
    onlineOnly: true,
    promotionAbility: "deny",
    fallbackSymbols: ["o", "e", "x"],
    image: getPieceImageAsync("restrictors", "anchor"),
    value: 0,
    displayName: "Anchor",
    description:
      "Disappears at the start of next turn.",
    diagram: {
      size: 5,
      rows: [".....", ".....", "..o..", ".....", "....."],
    },
  },
} satisfies Record<string, PieceType>;

export default fairyPieces;
