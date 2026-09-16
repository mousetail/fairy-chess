import { type PieceType } from "./index.ts";
import { getPieceImageAsync } from "../utils.ts";

const combinationPieces = {
  knook: {
    symbol: "c",
    betza: "RN",
    fallbackSymbols: ["w"],
    image: getPieceImageAsync("centaur", "centaur-rook"),
    value: 9,
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
    value: 9,
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
    value: 11,
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
    value: 7,
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
    value: 8,
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
    value: 9,
    displayName: "Ring",
    description: "Moves as a rook or as a king.",
    diagram: {
      size: 5,
      rows: ["..x..", ".xxx.", "xxoxx", ".xxx.", "..x.."],
    },
  },
} satisfies Record<string, PieceType>;

export default combinationPieces;
