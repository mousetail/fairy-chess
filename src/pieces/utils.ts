import type { Piece, SpecialMovement, TaggedMove, Tile } from "../chess-game";
import { pieces } from "../chess-game";

export type Behavior = (
  piece: Piece,
  pieces: Piece[],
  lastMove: TaggedMove | undefined,
) => SpecialMovement[];

function isInBounds(pos: Tile): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < 8 && pos.y < 8;
}

export function normalizeColor(
  inner: (
    position: Tile,
    isOccupied: (tile: Tile) => boolean,
    isOccupiedByEnemy: (tile: Tile) => boolean,
  ) => SpecialMovement[],
): Behavior {
  return (piece, pieces, lastMove) => {
    function invertIfBlack(pos: Tile): Tile {
      return piece.color === "black" ? { x: 7 - pos.x, y: 7 - pos.y } : pos;
    }

    console.log(lastMove?.passedTilesForEnPassant);

    const moves = inner(
      invertIfBlack(piece.position),
      (tile: Tile) =>
        pieces.some(
          (p) =>
            invertIfBlack(p.position).x === tile.x &&
            invertIfBlack(p.position).y === tile.y,
        ),
      (tile: Tile) => {
        tile = invertIfBlack(tile);
        return (
          pieces.some(
            (p) =>
              tile.x === p.position.x &&
              tile.y === p.position.y &&
              p.color !== piece.color,
          ) ||
          lastMove?.passedTilesForEnPassant?.some(
            (t) => t.x === tile.x && t.y === tile.y,
          ) ||
          false
        );
      },
    );
    return moves.map((move): SpecialMovement => ({
      ...move,
      to: invertIfBlack(move.to),
      passedTilesForEnPassant: move.passedTilesForEnPassant?.map(invertIfBlack),
    }));
  };
}

export function jumpBehavior(directions: Tile[]): Behavior {
  return (piece, pieces, _lastMove) => {
    return directions
      .map((dir) => ({
        tile: { x: piece.position.x + dir.x, y: piece.position.y + dir.y },
      }))
      .filter((move) => {
        if (!isInBounds(move.tile)) {
          return false;
        }
        const target = pieces.find(
          (p) => p.position.x === move.tile.x && p.position.y === move.tile.y,
        );
        return !target || target.color !== piece.color;
      })
      .map((move) => {
        const target = pieces.find(
          (p) => p.position.x === move.tile.x && p.position.y === move.tile.y,
        );
        return { to: move.tile, type: target ? "capture" : "move" };
      });
  };
}

export function moveBehavior(directions: Tile[]): Behavior {
  return (piece, pieces) => {
    return directions.flatMap((dir) => {
      let position = {
        x: piece.position.x + dir.x,
        y: piece.position.y + dir.y,
      };
      let tiles: SpecialMovement[] = [];
      while (
        isInBounds(position) &&
        !pieces.some(
          (p) => p.position.x === position.x && p.position.y === position.y,
        )
      ) {
        tiles.push({ to: { ...position }, type: "move" });
        position.x += dir.x;
        position.y += dir.y;
      }
      if (
        isInBounds(position) &&
        pieces.some(
          (p) =>
            p.position.x === position.x &&
            p.position.y === position.y &&
            p.color != piece.color,
        )
      ) {
        tiles.push({ to: { ...position }, type: "capture" });
      }

      return tiles;
    });
  };
}

export function pawnBehavior(
  position: Tile,
  isOccupied: (tile: Tile) => boolean,
  isOccupiedByEnemy: (tile: Tile) => boolean,
): SpecialMovement[] {
  const moves: SpecialMovement[] = [];
  const direction = 1; // White moves up (increasing y)

  // Single move forward
  const singleForward = { x: position.x, y: position.y + direction };
  if (
    singleForward.y >= 0 &&
    singleForward.y < 8 &&
    !isOccupied(singleForward)
  ) {
    const move: SpecialMovement = { to: singleForward, type: "move" };
    console.log("single forward.y", singleForward.y);
    moves.push(move);
  }

  // Double move forward from second rank
  if (position.y === 1) {
    // Starting from y=6 (second rank)
    const doubleForward = { x: position.x, y: position.y + 2 * direction };
    if (
      doubleForward.y >= 0 &&
      doubleForward.y < 8 &&
      !isOccupied(doubleForward) &&
      !isOccupied(singleForward)
    ) {
      moves.push({
        to: doubleForward,
        type: "move",
        passedTilesForEnPassant: [singleForward],
      });
    }
  }

  // Captures diagonally forward
  const captureLeft = { x: position.x - 1, y: position.y + direction };
  const captureRight = { x: position.x + 1, y: position.y + direction };

  for (const capture of [captureLeft, captureRight]) {
    if (capture.x >= 0 && capture.x < 8 && capture.y >= 0 && capture.y < 8) {
      if (isOccupiedByEnemy(capture)) {
        moves.push({ to: capture, type: "capture" });
      }
    }
  }

  return moves.map((move) =>
    move.to.y === 7
      ? {
          ...move,
          promotion: {
            state: "pending",
            options: [pieces.queen, pieces.rook, pieces.bishop, pieces.knight],
          },
        }
      : move,
  );
}
