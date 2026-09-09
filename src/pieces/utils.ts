import type { Piece, SpecialMovement, Tile } from "../chess-game";

export type Behavior = (piece: Piece, pieces: Piece[]) => SpecialMovement[];

export function normalizeColor(
  inner: (
    position: Tile,
    isOccupied: (tile: Tile) => boolean,
    isOccupiedByEnemy: (tile: Tile) => boolean,
  ) => SpecialMovement[],
): Behavior {
  return (piece, pieces) => {
    function invertIfBlack(pos: Tile): Tile {
      return piece.color === "black" ? { x: 7 - pos.x, y: 7 - pos.y } : pos;
    }

    const moves = inner(
      invertIfBlack(piece.position),
      (tile: Tile) =>
        pieces.some(
          (p) =>
            invertIfBlack(p.position).x === tile.x &&
            invertIfBlack(p.position).y === tile.y,
        ),
      (tile: Tile) =>
        pieces.some(
          (p) =>
            invertIfBlack(p.position).x === tile.x &&
            invertIfBlack(p.position).y === tile.y &&
            p.color !== piece.color,
        ),
    );
    return moves.map((move) => ({
      ...move,
      tile: invertIfBlack(move.tile),
      canEnPassantTo: move.passedTilesForEnPassant?.map(invertIfBlack),
    }));
  };
}

export function jumpBehavior(directions: Tile[]): Behavior {
  return (piece, pieces) => {
    return directions
      .map((dir) => ({
        tile: { x: piece.position.x + dir.x, y: piece.position.y + dir.y },
      }))
      .filter((move) => {
        if (
          move.tile.x < 0 ||
          move.tile.y < 0 ||
          move.tile.x >= 8 ||
          move.tile.y >= 8
        ) {
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
        return { tile: move.tile, type: target ? "capture" : "move" };
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
        position.x >= 0 &&
        position.y >= 0 &&
        position.x < 8 &&
        position.y < 8 &&
        !pieces.some(
          (p) => p.position.x === position.x && p.position.y === position.y,
        )
      ) {
        tiles.push({ tile: { ...position }, type: "move" });
        position.x += dir.x;
        position.y += dir.y;
      }
      if (
        position.x >= 0 &&
        position.y >= 0 &&
        position.x < 8 &&
        position.y < 8 &&
        pieces.some(
          (p) =>
            p.position.x === position.x &&
            p.position.y === position.y &&
            p.color != piece.color,
        )
      ) {
        tiles.push({ tile: { ...position }, type: "capture" });
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
  const direction = 1; // White moves up (decreasing y)

  // Single move forward
  const singleForward = { x: position.x, y: position.y + direction };
  if (
    singleForward.y >= 0 &&
    singleForward.y < 8 &&
    !isOccupied(singleForward)
  ) {
    const move: SpecialMovement = { tile: singleForward, type: "move" };
    if (singleForward.y === 7) {
      // Promotion on 8th rank
      move.isPromotion = true;
    }
    moves.push(move);
  }

  // Double move forward from second rank
  if (position.y === 1) {
    // Starting from y=6 (second rank)
    const doubleForward = { x: position.x, y: position.y + 2 * direction };
    if (
      doubleForward.y >= 0 &&
      doubleForward.y < 8 &&
      !isOccupied(doubleForward)
    ) {
      moves.push({
        tile: doubleForward,
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
        moves.push({ tile: capture, type: "capture" });
      }
    }
  }

  return moves;
}
