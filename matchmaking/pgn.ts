/** One played move as it is logged: whose it was, and it in algebraic notation. */
export interface LoggedMove {
  color: "white" | "black";
  pgn: string;
}

/**
 * A finished game's moves as a PGN move list.
 *
 * White always moves first, so a white move opens a numbered pair and the black
 * reply follows it. The result is left off: it is already stored beside the
 * moves, and a game that was called off has none to write. The notation is
 * written with the game's own piece symbols, so the alias map kept beside it is
 * what makes it readable.
 */
export function movesToPgn(moves: LoggedMove[]): string {
  const parts: string[] = [];
  for (let index = 0; index < moves.length; index++) {
    if (moves[index].color === "white") parts.push(`${index / 2 + 1}.`);
    parts.push(moves[index].pgn);
  }
  return parts.join(" ");
}
