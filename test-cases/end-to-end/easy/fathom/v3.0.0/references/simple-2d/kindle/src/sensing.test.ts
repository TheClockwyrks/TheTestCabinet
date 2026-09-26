import { describe, expect, it } from "vitest";
import { GRID_COLS, GRID_ROWS, TILE } from "./constants";
import { centerX, centerY, tileIndex } from "./grid";
import { loadLayout } from "./maze";
import {
  castLight,
  drifterLit,
  emptyGrid,
  lightDisc,
  lineOfSightClear,
  visibilityRows,
  visionRadius,
  windowRadius,
} from "./sensing";
import { createDrifter } from "./simulate";
import type { MazeState, Tile } from "./state";

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

describe("line of sight", () => {
  it("runs clear along an open corridor", () => {
    const maze = board(["......"], 4, 4);
    expect(lineOfSightClear(maze, 4, 4, 9, 4)).toBe(true);
  });

  it("is blocked by rock between the two tiles", () => {
    const maze = board(["..#..."], 4, 4);
    expect(lineOfSightClear(maze, 4, 4, 9, 4)).toBe(false);
  });

  it("reaches the rock it lands on, so that tile itself is lit", () => {
    const maze = board(["..#"], 4, 4);
    expect(lineOfSightClear(maze, 4, 4, 6, 4)).toBe(true);
  });
});

describe("the forager's light", () => {
  it("lights the tiles inside its radius and remembers them", () => {
    const maze = board([".........."], 4, 4);
    const { revealed, lit } = castLight(
      maze,
      emptyGrid(),
      centerX(6),
      centerY(4),
      2 * TILE,
    );
    expect(lit[tileIndex(6, 4)]).toBe(true);
    expect(lit[tileIndex(8, 4)]).toBe(true);
    expect(lit[tileIndex(9, 4)]).toBe(false);
    expect(revealed[tileIndex(8, 4)]).toBe(true);
  });

  it("stops at rock and leaves what is behind it as it was", () => {
    const maze = board(["..#..."], 4, 4);
    const { lit } = castLight(
      maze,
      emptyGrid(),
      centerX(4),
      centerY(4),
      5 * TILE,
    );
    expect(lit[tileIndex(6, 4)]).toBe(true);
    expect(lit[tileIndex(7, 4)]).toBe(false);
  });

  it("keeps what an earlier cast revealed", () => {
    const maze = board([".........."], 4, 4);
    const first = castLight(maze, emptyGrid(), centerX(4), centerY(4), TILE);
    const second = castLight(
      maze,
      first.revealed,
      centerX(12),
      centerY(4),
      TILE,
    );
    expect(second.revealed[tileIndex(4, 4)]).toBe(true);
    expect(second.lit[tileIndex(4, 4)]).toBe(false);
  });
});

describe("a flare's disc", () => {
  it("lights floor and rock alike, straight through the rock between", () => {
    const revealed = emptyGrid();
    const lit = emptyGrid();
    lightDisc(revealed, lit, centerX(4), centerY(4), 3 * TILE);
    expect(lit[tileIndex(6, 4)]).toBe(true);
    expect(lit[tileIndex(7, 4)]).toBe(true);
    expect(revealed[tileIndex(7, 4)]).toBe(true);
  });
});

describe("the visibility the snapshot reports", () => {
  it("reports one character per tile in the layout's own shape", () => {
    const revealed = emptyGrid();
    const lit = emptyGrid();
    revealed[tileIndex(3, 2)] = true;
    revealed[tileIndex(4, 2)] = true;
    lit[tileIndex(4, 2)] = true;
    const rows = visibilityRows(revealed, lit);
    expect(rows).toHaveLength(GRID_ROWS);
    expect(rows[0]).toHaveLength(GRID_COLS);
    expect(rows[2][3]).toBe("r");
    expect(rows[2][4]).toBe("l");
    expect(rows[2][5]).toBe("u");
  });
});

describe("the two circles the forager carries", () => {
  it("takes the light radius from the brightness", () => {
    expect(visionRadius(0)).toBe(96);
    expect(visionRadius(0.5)).toBe(128);
    expect(visionRadius(1)).toBe(160);
  });

  it("takes the vision circle from the same brightness", () => {
    expect(windowRadius(0)).toBe(192);
    expect(windowRadius(0.5)).toBe(256);
    expect(windowRadius(1)).toBe(320);
  });

  it("keeps the vision circle outside the light at every brightness", () => {
    for (let g = 0; g <= 1.0001; g += 0.05) {
      expect(windowRadius(g)).toBeGreaterThan(visionRadius(g));
    }
  });
});

describe("whether a drifter's body is drawn", () => {
  it("draws it where the fog holds its tile lit", () => {
    const lit = emptyGrid();
    lit[tileIndex(6, 3)] = true;
    const drifter = createDrifter(6, 3);
    expect(drifterLit(lit, drifter)).toBe(true);
  });

  it("leaves it undrawn where its tile is not lit", () => {
    const lit = emptyGrid();
    lit[tileIndex(7, 3)] = true;
    const drifter = createDrifter(6, 3);
    expect(drifterLit(lit, drifter)).toBe(false);
  });
});
