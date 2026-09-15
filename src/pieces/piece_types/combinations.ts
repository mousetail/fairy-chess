import { type PieceType } from "./index.ts";
import { getPieceImageAsync } from "../utils.ts";

// The knight combinations use the centaur artwork; the king combinations have
// no dedicated artwork yet, so they borrow the classic image of their other
// component.
//
// Symbols follow the Fairy-Stockfish letters for each movement pattern:
//   knook   = chancellor (RN) = c
//   knishop = archbishop (BN) = a
//   kniween = amazon (QN)     = a
//   kning   = centaur (KN)    = c
// The knight compounds therefore share symbols with each other; the per-game
// symbol map picks the fallbacks when they appear together. bing and ring have
// no standard Fairy-Stockfish piece, so they use free letters.
const combinationPieces = {
  knook: {
    symbol: "c",
    betza: "RN",
    fallbackSymbols: ["w"],
    image: getPieceImageAsync("centaur", "centaur-rook"),
    value: 8,
    displayName: "Knook",
    aliases: ["Empress", "Chancellor"],
    description: "Moves as a rook or as a knight.",
    diagram: {
      size: 5,
      rows: [".xxx.", "x.x.x", "xxoxx", "x.x.x", ".xxx."],
    },
  },
  knishop: {
    symbol: "a",
    betza: "BN",
    fallbackSymbols: ["v"],
    image: getPieceImageAsync("centaur", "centaur-bishop"),
    value: 6,
    displayName: "Knishop",
    aliases: ["Archbishop", "Princess"],
    description: "Moves as a bishop or as a knight.",
    diagram: {
      size: 5,
      rows: ["xxxxx", "xxxxx", "..o..", "xxxxx", "xxxxx"],
    },
  },
  kniween: {
    symbol: "a",
    betza: "QN",
    fallbackSymbols: ["g"],
    image: getPieceImageAsync("centaur", "centaur-queen"),
    value: 12,
    displayName: "Kniween",
    aliases: ["Amazon"],
    description: "Moves as a queen or as a knight.",
    diagram: {
      size: 5,
      rows: ["xxxxx", "xxxxx", "xxoxx", "xxxxx", "xxxxx"],
    },
  },
  kning: {
    symbol: "c",
    betza: "KN",
    fallbackSymbols: ["h"],
    image: getPieceImageAsync("centaur", "centaur-king"),
    value: 3,
    displayName: "Kning",
    aliases: ["Centaur"],
    description: "Moves as a king or as a knight.",
    diagram: {
      size: 5,
      rows: [".x.x.", "xxxxx", ".xox.", "xxxxx", ".x.x."],
    },
  },
  bing: {
    symbol: "i",
    betza: "BK",
    image: getPieceImageAsync("helios", "helios-bishop"),
    value: 3,
    displayName: "Bing",
    description: "Moves as a bishop or as a king.",
    diagram: {
      size: 5,
      rows: ["x...x", ".xxx.", ".xox.", ".xxx.", "x...x"],
    },
  },
  ring: {
    symbol: "e",
    betza: "RK",
    image: getPieceImageAsync("helios", "helios-rook"),
    value: 5,
    displayName: "Ring",
    description: "Moves as a rook or as a king.",
    diagram: {
      size: 5,
      rows: ["..x..", ".xxx.", "xxoxx", ".xxx.", "..x.."],
    },
  },
} satisfies Record<string, PieceType>;

export default combinationPieces;
