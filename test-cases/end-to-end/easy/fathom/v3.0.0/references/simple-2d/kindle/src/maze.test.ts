import { describe, expect, it } from "vitest";
import { GRID_COLS, GRID_ROWS } from "./constants";
import {
  firstCorridor,
  firstStepToward,
  floodBuckets,
  foragerCanEnter,
  layoutProblem,
  loadLayout,
  predatorCanEnter,
  stepTile,
  wallMask,
} from "./maze";
import type { MazeState, Tile } from "./state";

/** A full-size layout with `art` stamped into solid rock at `(x, y)`. */
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

describe("loading a layout", () => {
  it("refuses a layout of the wrong size", () => {
    expect(layoutProblem(["#".repeat(GRID_COLS)])).toMatch(/expected 18 rows/);
    expect(
      layoutProblem(
        Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS - 1)),
      ),
    ).toMatch(/35 characters/);
  });

  it("refuses a character outside the tile alphabet", () => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[3] = "#".repeat(10) + "x" + "#".repeat(GRID_COLS - 11);
    expect(layoutProblem(rows)).toMatch(/unknown tile character/);
  });

  it("refuses den tiles without exactly one gate", () => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[5] = "#".repeat(10) + "dd" + "#".repeat(GRID_COLS - 12);
    expect(layoutProblem(rows)).toMatch(/exactly one gate/);
    rows[4] = "#".repeat(10) + "gg" + "#".repeat(GRID_COLS - 12);
    expect(layoutProblem(rows)).toMatch(/exactly one gate/);
  });

  it("accepts a fixture with no den and no wrap tunnel at all", () => {
    const maze = board(["...."], 4, 4);
    expect(maze.wrapRow).toBe(-1);
    expect(maze.gate).toBeNull();
    expect(maze.denTiles).toEqual([]);
  });

  it("reads the den, the gate and the wrap row off the layout", () => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[6] = "#".repeat(17) + "g" + "#".repeat(GRID_COLS - 18);
    rows[7] = "#".repeat(16) + "ddd" + "#".repeat(GRID_COLS - 19);
    rows[11] = "." + "#".repeat(GRID_COLS - 2) + ".";
    const maze = loadLayout(rows);
    expect(maze.gate).toEqual({ tx: 17, ty: 6 });
    expect(maze.denTiles).toHaveLength(3);
    expect(maze.wrapRow).toBe(11);
  });

  it("rests the forager on the first corridor tile in reading order", () => {
    const maze = board(["..", "..."], 5, 9);
    expect(firstCorridor(maze.rows)).toEqual({ tx: 5, ty: 9 });
    expect(maze.start).toEqual({ tx: 5, ty: 9 });
  });
});

describe("tile queries", () => {
  it("opens corridors to the forager and the den to predators alone", () => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[6] = "#".repeat(17) + "g" + "#".repeat(GRID_COLS - 18);
    rows[7] = "#".repeat(17) + "d" + "#".repeat(GRID_COLS - 18);
    rows[5] = "#".repeat(17) + "." + "#".repeat(GRID_COLS - 18);
    const maze = loadLayout(rows);
    expect(foragerCanEnter(maze, 17, 5)).toBe(true);
    expect(foragerCanEnter(maze, 17, 6)).toBe(false);
    expect(foragerCanEnter(maze, 17, 7)).toBe(false);
    expect(predatorCanEnter(maze, 17, 6)).toBe(true);
    expect(predatorCanEnter(maze, 17, 7)).toBe(true);
    expect(predatorCanEnter(maze, 0, 0)).toBe(false);
  });

  it("joins the two mouths of the wrap tunnel as neighbors", () => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[9] = ".".repeat(GRID_COLS);
    const maze = loadLayout(rows);
    expect(stepTile(maze, 0, 9, "left")).toEqual({ tx: GRID_COLS - 1, ty: 9 });
    expect(stepTile(maze, GRID_COLS - 1, 9, "right")).toEqual({ tx: 0, ty: 9 });
    // Any other row simply runs off the grid.
    expect(stepTile(maze, 0, 4, "left")).toEqual({ tx: -1, ty: 4 });
  });

  it("reads the autotile mask off a rock tile's rock neighbors", () => {
    const maze = board(["...", ".#.", "..."], 4, 4);
    // The lone rock at (5, 5) has open water on all four sides.
    expect(wallMask(maze, 5, 5)).toBe(0);
    // A rock outside the stamped patch is surrounded by rock.
    expect(wallMask(maze, 20, 12)).toBe(15);
  });
});

describe("the corridor flood and the routes through it", () => {
  it("groups the flood by corridor distance, near tiles first", () => {
    const maze = board(["....."], 4, 4);
    const buckets = floodBuckets(maze, 4, 4, 4);
    expect(buckets[0]).toEqual([{ tx: 4, ty: 4 }]);
    expect(buckets[1]).toEqual([{ tx: 5, ty: 4 }]);
    expect(buckets[3]).toEqual([{ tx: 7, ty: 4 }]);
    expect(buckets).toHaveLength(5);
  });

  it("bends around a bend and enters nothing rock seals off", () => {
    const maze = board(["..#", "#.#", "#.."], 4, 4);
    const buckets = floodBuckets(maze, 4, 4, 6);
    const reached = buckets.flat();
    expect(reached).toContainEqual({ tx: 6, ty: 6 });
    expect(reached).not.toContainEqual({ tx: 6, ty: 4 });
  });

  it("takes the way round an obstacle rather than walking into it", () => {
    // The route from (4, 6) to (4, 4) is blocked straight up, so the first step
    // has to be sideways.
    const maze = board(["...", "##.", "..."], 4, 4);
    expect(
      firstStepToward(maze, 4, 6, 4, 4, (tx, ty) =>
        foragerCanEnter(maze, tx, ty),
      ),
    ).toBe("right");
  });

  it("has no first step when the route is run or there is none", () => {
    const maze = board(["...", "###", "..."], 4, 4);
    expect(
      firstStepToward(maze, 4, 4, 4, 4, (tx, ty) =>
        foragerCanEnter(maze, tx, ty),
      ),
    ).toBeNull();
    expect(
      firstStepToward(maze, 4, 4, 4, 6, (tx, ty) =>
        foragerCanEnter(maze, tx, ty),
      ),
    ).toBeNull();
  });
});
