import assert from "node:assert/strict";
import {
  type ChessBoardState,
  movementHasPendingPromotion,
} from "../../src/chess-board.ts";
import { ChessGame } from "../../src/chess-game.ts";
import {
  deserializeBoardState,
  deserializeMove,
  pieceTypeKey,
} from "../../src/online/serialization.ts";
import { GameSession } from "../game-session.ts";
import { type LoggedMove, movesToPgn, parsePgn } from "../pgn.ts";
import { replayGame } from "../replay.ts";

/**
 * A game is stored as a PGN move list and the FEN it started from, so reading it
 * back means playing those moves onto that position again. These tests do the
 * round trip at each kind of layout: the pieces are all different, and a move
 * only names the right one through the alias map.
 */

const ignore = () => {};

/** Plays up to `count` moves, chosen from the session's own legal moves. */
function playSome(session: GameSession, count: number): LoggedMove[] {
  const moves: LoggedMove[] = [];
  while (moves.length < count) {
    if (session.finished) break;
    const color = session.game.state.turn;
    const piece = session.game.state.pieces.find(
      (candidate) =>
        candidate.color === color &&
        session.game.getValidMoves(candidate).length > 0,
    );
    if (!piece) break;

    const movement = session.game
      .getValidMoves(piece)
      .find((move) => !movementHasPendingPromotion(move));
    if (!movement) break;

    const outcome = session.play(color, {
      pieceId: piece.id,
      from: { x: piece.position.x, y: piece.position.y },
      to: movement.to,
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.rejection.reason}`);
    moves.push({ color, pgn: outcome.applied.pgn });
  }
  return moves;
}

/** The pieces and whose turn it is, which is what a replay has to reproduce. */
function shape(state: ChessBoardState) {
  return {
    turn: state.turn,
    pieces: state.pieces
      .map((piece) =>
        `${piece.color} ${pieceTypeKey(piece.type)} ` +
        `${piece.position.x},${piece.position.y} ${piece.hasMoved}`
      )
      .sort(),
  };
}

for (const complexity of [0, 1, 2, 4]) {
  Deno.test(`a game at level ${complexity} replays from its record`, () => {
    const session = new GameSession(complexity);
    const fen = session.fen();
    const symbols = session.symbols();
    const moves = playSome(session, 16);
    assert.ok(moves.length > 0, "there should be something to replay");

    // Written as a PGN, read back, and played out onto the opening position.
    const history = replayGame(fen, symbols, parsePgn(movesToPgn(moves)));
    assert.equal(history.moves.length, moves.length);

    const game = new ChessGame();
    game.state = deserializeBoardState(history.initialBoard);
    for (const play of history.moves) {
      const move = deserializeMove(play.move, game.state);
      assert.ok(move, `the piece playing ${play.pgn} should be on the board`);
      game.movePiece(move, ignore, ignore, ignore, ignore, ignore);
    }

    assert.deepEqual(shape(game.state), shape(session.game.state));
  });
}

Deno.test("castling keeps the side it was played on", () => {
  // 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O
  const session = new GameSession(0);
  const fen = session.fen();
  const symbols = session.symbols();
  const line: [number, [number, number], [number, number]][] = [
    [4, [4, 1], [4, 3]],
    [12, [4, 6], [4, 4]],
    [22, [6, 0], [5, 2]],
    [25, [1, 7], [2, 5]],
    [21, [5, 0], [2, 3]],
    [29, [5, 7], [2, 4]],
    [20, [4, 0], [6, 0]],
  ];

  const moves: LoggedMove[] = [];
  for (const [pieceId, from, to] of line) {
    const color = session.game.state.turn;
    const outcome = session.play(color, {
      pieceId,
      from: { x: from[0], y: from[1] },
      to: { x: to[0], y: to[1] },
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.rejection.reason}`);
    moves.push({ color, pgn: outcome.applied.pgn });
  }

  // The castle is written as O-O, not as a king's walk to g1, and replays as
  // one: which rook the king went to is not lost.
  const pgn = movesToPgn(moves);
  assert.match(pgn, /4\. O-O/);
  const history = replayGame(fen, symbols, parsePgn(pgn));
  assert.equal(history.moves.at(-1)?.pgn, "O-O");
  assert.ok(history.moves.at(-1)?.move.castling, "the castle should survive");
});
