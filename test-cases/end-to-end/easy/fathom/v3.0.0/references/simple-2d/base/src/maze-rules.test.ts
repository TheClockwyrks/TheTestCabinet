import { describe, expect, it } from "vitest";
import { GRID_COLS, GRID_ROWS } from "./constants";
import { loadLayout } from "./maze";
import {
  INTERIOR_CELLS,
  corridorNeighbors,
  mazeFaults,
  measureMaze,
} from "./maze-rules";
import { generateMaze } from "./maze-generator";
import { createDraws } from "./rng";
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

describe("the proportions specs/maze.md fixes", () => {
  it("counts every corridor neighbor, the wrap tunnel's pair included", () => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[9] = ".".repeat(GRID_COLS);
    const maze = loadLayout(rows);
    expect(corridorNeighbors(maze, 0, 9)).toHaveLength(2);
    expect(corridorNeighbors(maze, GRID_COLS - 1, 9)).toHaveLength(2);
  });

  it("measures a ring of corridor as one run at an openness of two", () => {
    const maze = board(["....", ".##.", ".##.", "...."], 4, 4, {
      tx: 4,
      ty: 4,
    });
    const measures = measureMaze(maze);
    expect(measures.openness).toBeCloseTo(2);
    expect(measures.corridorRun).toBeCloseTo(12);
    expect(measures.density).toBeCloseTo(12 / INTERIOR_CELLS);
  });

  it("counts the interior the density is measured against", () => {
    expect(INTERIOR_CELLS).toBe(544);
  });
});

describe("the faults a layout can carry", () => {
  it("finds none in a maze the generator laid out", () => {
    expect(mazeFaults(generateMaze(createDraws(1)))).toEqual([]);
  });

  it("names a dead end, a broken border and a missing den", () => {
    const maze = board(["...", "..#"], 4, 4, { tx: 4, ty: 4 });
    const faults = mazeFaults(maze).join("\n");
    expect(faults).toMatch(/dead end/);
    expect(faults).toMatch(/no den chamber/);
    expect(faults).toMatch(/rows pierce the border/);
  });

  it("names a 2 x 2 block of corridor", () => {
    const maze = board(["..", ".."], 4, 4, { tx: 4, ty: 4 });
    expect(mazeFaults(maze).join("\n")).toMatch(
      /2x2 block of corridor at \(4, 4\)/,
    );
  });

  it("names a column that does not mirror its opposite", () => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[9] = "#." + "#".repeat(GRID_COLS - 2);
    const maze = loadLayout(rows, { tx: 1, ty: 9 });
    expect(mazeFaults(maze).join("\n")).toMatch(
      /column 1 does not mirror column 34/,
    );
  });

  it("names a den chamber that opens straight onto a corridor", () => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[6] = "#".repeat(17) + "g" + "#".repeat(GRID_COLS - 18);
    rows[7] = "#".repeat(16) + ".d" + "#".repeat(GRID_COLS - 18);
    const maze = loadLayout(rows, { tx: 16, ty: 7 });
    expect(mazeFaults(maze).join("\n")).toMatch(
      /opens straight onto a corridor/,
    );
  });

  it("names a start tile outside the rows a dive begins on", () => {
    const maze = board(["....", ".##.", ".##.", "...."], 4, 2, {
      tx: 4,
      ty: 2,
    });
    expect(mazeFaults(maze).join("\n")).toMatch(/outside rows 9 through 16/);
  });
});
