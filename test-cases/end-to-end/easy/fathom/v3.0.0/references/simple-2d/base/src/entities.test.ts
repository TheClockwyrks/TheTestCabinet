import { describe, expect, it } from "vitest";
import {
  DRIFTER_SPEED,
  FORAGER_SPEED,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ROWS,
  TICK_DT,
  TILE,
} from "./constants";
import { centerX, centerY, columnAt, rowAt } from "./grid";
import { foragerCanEnter, loadLayout } from "./maze";
import {
  atTileCenter,
  bodyTile,
  driftBody,
  moveBody,
  restAt,
  wanderDirection,
  type Body,
} from "./entities";
import { createDraws } from "./rng";
import type { Heading, MazeState, Tile } from "./state";

function board(
  art: readonly string[],
  x: number,
  y: number,
  start?: Tile,
): MazeState {
  const grid = Array.from({ length: GRID_ROWS }, () =>
    "#".repeat(GRID_COLS).split(""),
  );
  art.forEach((line, i) => {
    line.split("").forEach((ch, j) => {
      grid[y + i][x + j] = ch;
    });
  });
  return loadLayout(
    grid.map((row) => row.join("")),
    start,
  );
}

function at(tx: number, ty: number, heading: Heading = null): Body {
  return { x: centerX(tx), y: centerY(ty), facing: "up", heading };
}

function swim(
  body: Body,
  maze: MazeState,
  request: Heading,
  ticks: number,
  speed = FORAGER_SPEED,
): Body {
  let current = body;
  for (let i = 0; i < ticks; i++) {
    current = moveBody(current, {
      maze,
      speed,
      dt: TICK_DT,
      canEnter: (tx, ty) => foragerCanEnter(maze, tx, ty),
      request,
      decide: () => request,
    });
  }
  return current;
}

describe("travelling the maze", () => {
  it("travels at exactly its own speed, whatever the frames were", () => {
    const maze = board([".".repeat(20)], 4, 9);
    const body = swim(at(4, 9), maze, "right", 120);
    expect(body.x - centerX(4)).toBeCloseTo(FORAGER_SPEED, 3);
    expect(body.y).toBeCloseTo(centerY(9));
  });

  it("comes to rest at the center when the tile ahead is rock", () => {
    const maze = board(["..."], 4, 9);
    const body = swim(at(4, 9), maze, "right", 240);
    expect(bodyTile(body)).toEqual({ tx: 6, ty: 9 });
    expect(atTileCenter(body)).toBe(true);
    expect(body.heading).toBeNull();
    expect(body.x).toBeCloseTo(centerX(6));
  });

  it("takes a perpendicular turn at a tile center and nowhere else", () => {
    const maze = board(["...", "#.#", "..."], 4, 9);
    // Part of the way into the first step, a turn downward is not taken yet.
    const partway = swim(at(4, 9), maze, "right", 8);
    expect(partway.x).toBeGreaterThan(centerX(4));
    expect(partway.x).toBeLessThan(centerX(5));
    const turned = swim(partway, maze, "down", 6);
    expect(turned.y).toBeCloseTo(centerY(9));
    // Carried on to the center of (5, 9), the turn is taken there.
    const later = swim(turned, maze, "down", 60);
    expect(later.y).toBeGreaterThan(centerY(9));
    expect(later.x).toBeCloseTo(centerX(5));
  });

  it("reverses wherever it stands, without waiting for a center", () => {
    const maze = board([".".repeat(8)], 4, 9);
    const partway = swim(at(4, 9), maze, "right", 8);
    const back = swim(partway, maze, "left", 1);
    expect(back.x).toBeLessThan(partway.x);
  });

  it("stays put when no neighbor is open to it", () => {
    const maze = board(["."], 4, 9);
    const body = swim(at(4, 9), maze, "right", 60);
    expect(body.x).toBeCloseTo(centerX(4));
    expect(body.heading).toBeNull();
  });

  it("crosses the wrap tunnel as one ordinary step, staying in the maze region", () => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[9] = ".".repeat(GRID_COLS);
    const maze = loadLayout(rows);
    let body = at(0, 9, "left");
    let crossed = false;
    for (let i = 0; i < 60; i++) {
      body = swim(body, maze, "left", 1);
      expect(body.x).toBeGreaterThanOrEqual(GRID_ORIGIN_X);
      expect(body.x).toBeLessThanOrEqual(GRID_ORIGIN_X + GRID_COLS * TILE);
      if (columnAt(body.x) === GRID_COLS - 1) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(rowAt(body.y)).toBe(9);
  });

  it("keeps the facing it was left with while it rests", () => {
    const body = restAt({ ...at(4, 9), facing: "left" }, 5, 9);
    expect(body).toEqual({
      x: centerX(5),
      y: centerY(9),
      facing: "left",
      heading: null,
    });
  });
});

describe("the wander a drifter and a wandering Lanternjaw share", () => {
  it("prefers a direction other than an immediate reverse", () => {
    const maze = board(["..."], 4, 9);
    const draws = createDraws();
    for (let i = 0; i < 50; i++) {
      expect(
        wanderDirection(
          at(5, 9, "right"),
          maze,
          (tx, ty) => foragerCanEnter(maze, tx, ty),
          draws,
        ),
      ).toBe("right");
    }
  });

  it("turns back the way it came where the tile offers nothing else", () => {
    const maze = board([".."], 4, 9);
    const draws = createDraws();
    expect(
      wanderDirection(
        at(5, 9, "right"),
        maze,
        (tx, ty) => foragerCanEnter(maze, tx, ty),
        draws,
      ),
    ).toBe("left");
  });

  it("drifts at its own pace and stays on the corridors", () => {
    const maze = board(["....", ".##.", ".##.", "...."], 4, 8);
    const draws = createDraws();
    let body = at(4, 8, "right");
    for (let i = 0; i < 600; i++) {
      body = driftBody(body, maze, DRIFTER_SPEED, TICK_DT, draws);
      const tile = bodyTile(body);
      expect(
        foragerCanEnter(maze, tile.tx, tile.ty),
        `${tile.tx},${tile.ty}`,
      ).toBe(true);
    }
  });
});
