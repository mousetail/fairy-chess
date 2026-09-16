import assert from "node:assert/strict";
import { test } from "node:test";
import {
  movementHasNoPendingPromotion,
  type TaggedMove,
} from "../src/chess-board.ts";
import { ChessGame, type GameStatus } from "../src/chess-game.ts";
import { tileFromAlgebraic } from "./helpers.ts";

/**
 * Plays the move `from`-`to` for the side to move, as the screen does, and
 * reports what the game said about itself as it went.
 */
function play(game: ChessGame, from: string, to: string): GameStatus | null {
  const piece = game.getPieceAt(tileFromAlgebraic(from));
  assert.ok(piece, `there is no piece on ${from}`);
  const target = tileFromAlgebraic(to);
  const move = game.getValidMoves(piece).find(
    (candidate) => candidate.to.x === target.x && candidate.to.y === target.y,
  );
  assert.ok(move, `${from}${to} is not a legal move`);
  assert.ok(movementHasNoPendingPromotion(move), `${from}${to} promotes`);
  const tagged: TaggedMove = { ...move, from: piece.position, piece };

  let ended: GameStatus | null = null;
  game.movePiece(
    tagged,
    () => {},
    () => {},
    () => {},
    () => {},
    (status) => {
      ended = status;
    },
  );
  return ended;
}

/** Plays each move in turn and reports what each of them ended the game on. */
function playAll(
  game: ChessGame,
  moves: [string, string][],
): (GameStatus | null)[] {
  return moves.map(([from, to]) => play(game, from, to));
}

/**
 * The knights shuffle out and back, which brings the position the game was set
 * up in back to the board every four plies. A knight's having moved says
 * nothing about what may still be castled, so the knight is free to come home.
 */
const SHUFFLE: [string, string][] = [
  ["b1", "c3"],
  ["b8", "c6"],
  ["c3", "b1"],
  ["c6", "b8"],
];

test("the same position three times over is a draw", () => {
  const game = ChessGame.defaultLayout();

  // A round of the shuffle puts the position the game began in back on the
  // board, which is the second time it has been seen.
  assert.deepEqual(playAll(game, SHUFFLE), [null, null, null, null]);

  // Three moves later it is back for the third time, and the game is level the
  // moment it appears.
  assert.deepEqual(
    playAll(game, SHUFFLE.slice(0, 3)),
    [null, null, null],
  );
  assert.equal(play(game, "c6", "b8"), "repetition");
});

test("every position of the game counts, not just the recent ones", () => {
  const game = ChessGame.defaultLayout();
  // One move short of a draw, the knights wander off to the other side of the
  // board and home again.
  playAll(game, SHUFFLE);

  assert.deepEqual(
    playAll(game, [["b1", "a3"], ["b8", "a6"], ["a3", "b1"]]),
    [null, null, null],
  );
  // Coming home is the third time the game has seen the position it began in,
  // however long ago the first two of them were.
  assert.equal(play(game, "a6", "b8"), "repetition");
});
