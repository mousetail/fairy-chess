import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardPointFromEvent,
  tileFromEvent,
  tileOffset,
} from "../src/chess-screen/board-geometry.ts";

/**
 * A board element with a fixed size, standing in for the real one so the
 * geometry can be checked without a document. `flipped` is what the `black`
 * class on the real element means.
 */
function boardElement(flipped: boolean, size = 320): HTMLElement {
  return {
    classList: { contains: (name: string) => flipped && name === "black" },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: size,
      height: size,
    }),
  } as unknown as HTMLElement;
}

/** The tile under the centre of the square `file` from the left, `rank` down. */
function tileAt(
  flipped: boolean,
  file: number,
  rank: number,
): { x: number; y: number } | null {
  const square = 40;
  return tileFromEvent(boardElement(flipped), {
    clientX: file * square + square / 2,
    clientY: rank * square + square / 2,
  });
}

test("an unflipped board reads a1 from the bottom left", () => {
  assert.deepEqual(tileAt(false, 0, 7), { x: 0, y: 0 });
  assert.deepEqual(tileAt(false, 7, 0), { x: 7, y: 7 });
});

test("a flipped board is the same board turned half a turn", () => {
  // White's corner is now at the top right, and black's at the bottom left.
  assert.deepEqual(tileAt(true, 0, 7), { x: 7, y: 7 });
  assert.deepEqual(tileAt(true, 7, 0), { x: 0, y: 0 });

  // Every square lands where the half turn puts it.
  for (let file = 0; file < 8; file++) {
    for (let rank = 0; rank < 8; rank++) {
      assert.deepEqual(
        tileAt(true, file, rank),
        tileAt(false, 7 - file, 7 - rank),
        `square ${file},${rank} from the top`,
      );
    }
  }
});

test("a point outside the board is not a tile", () => {
  const board = boardElement(false);
  assert.equal(tileFromEvent(board, { clientX: -1, clientY: 10 }), null);
  assert.equal(tileFromEvent(board, { clientX: 10, clientY: 400 }), null);
  assert.equal(
    tileFromEvent(boardElement(true), { clientX: 400, clientY: 10 }),
    null,
  );
});

test("a point is reported in board coordinates, whichever way up it is", () => {
  const square = 40;
  const point = {
    clientX: square * 2 + square / 2,
    clientY: square * 3 + square / 2,
  };

  assert.deepEqual(boardPointFromEvent(boardElement(false), point), {
    x: 2.5,
    y: 3.5,
  });
  assert.deepEqual(boardPointFromEvent(boardElement(true), point), {
    x: 5.5,
    y: 4.5,
  });
});

test("a tile is placed where the board puts it, whichever way up it is", () => {
  const square = 40;
  const a1 = { x: 0, y: 0 };

  assert.deepEqual(tileOffset(boardElement(false), a1, square), {
    x: 0,
    y: 7 * square,
  });
  assert.deepEqual(tileOffset(boardElement(true), a1, square), {
    x: 7 * square,
    y: 0,
  });

  // A dragged piece is positioned from this, so it has to agree with the tile
  // the pointer is over.
  for (const flipped of [false, true]) {
    for (let file = 0; file < 8; file++) {
      for (let rank = 0; rank < 8; rank++) {
        const offset = tileOffset(
          boardElement(flipped),
          { x: file, y: 7 - rank },
          square,
        );
        assert.deepEqual(
          tileFromEvent(boardElement(flipped), {
            clientX: offset.x + square / 2,
            clientY: offset.y + square / 2,
          }),
          { x: file, y: 7 - rank },
          `square ${file},${rank} from the top`,
        );
      }
    }
  }
});
