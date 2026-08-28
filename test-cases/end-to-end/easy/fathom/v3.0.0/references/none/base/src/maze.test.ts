import { describe, expect, it } from "vitest";

import { board } from "./board.test-support";
import {
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  MAZE_DENSITY_MAX,
  MAZE_DENSITY_MIN,
  MAZE_MAZING_MAX,
  MAZE_MAZING_MIN,
  MAZE_OPENNESS_MAX,
  MAZE_OPENNESS_MIN,
  TILE,
} from "./constants";
import {
  density,
  Maze,
  meanCorridorRun,
  openness,
  SHIPPED_LAYOUT,
  SHIPPED_START,
} from "./maze";

describe("the shipped layout", () => {
  const maze = new Maze();

  it("is the grid the specification fixes", () => {
    expect(SHIPPED_LAYOUT).toHaveLength(GRID_ROWS);
    for (const row of SHIPPED_LAYOUT) expect(row).toHaveLength(GRID_COLS);
  });

  it("runs its corridors one tile wide", () => {
    for (let r = 0; r < GRID_ROWS - 1; r++) {
      for (let c = 0; c < GRID_COLS - 1; c++) {
        const open =
          maze.isCorridor(c, r) &&
          maze.isCorridor(c + 1, r) &&
          maze.isCorridor(c, r + 1) &&
          maze.isCorridor(c + 1, r + 1);
        expect(open, `2x2 open block at (${c}, ${r})`).toBe(false);
      }
    }
  });

  it("mirrors column c onto column GRID_COLS - 1 - c", () => {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const left = maze.at(c, r);
        const right = maze.at(GRID_COLS - 1 - c, r);
        if (left === "den" || left === "gate") continue;
        if (right === "den" || right === "gate") continue;
        expect(maze.isRock(c, r), `mirror mismatch at (${c}, ${r})`).toBe(
          maze.isRock(GRID_COLS - 1 - c, r),
        );
      }
    }
  });

  it("carries a solid border apart from the two wrap mouths", () => {
    for (let c = 0; c < GRID_COLS; c++) {
      expect(maze.isRock(c, 0)).toBe(true);
      expect(maze.isRock(c, GRID_ROWS - 1)).toBe(true);
    }
    for (let r = 0; r < GRID_ROWS; r++) {
      if (r === maze.wrapRow) continue;
      expect(maze.isRock(0, r)).toBe(true);
      expect(maze.isRock(GRID_COLS - 1, r)).toBe(true);
    }
    expect(maze.wrapRow).toBeGreaterThanOrEqual(0);
    expect(maze.isCorridor(0, maze.wrapRow)).toBe(true);
    expect(maze.isCorridor(GRID_COLS - 1, maze.wrapRow)).toBe(true);
  });

  it("has no dead end", () => {
    for (const tile of maze.corridorTiles()) {
      expect(
        maze.corridorNeighborCount(tile.col, tile.row),
        `dead end at (${tile.col}, ${tile.row})`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("is one connected region holding the start tile and both wrap mouths", () => {
    const tiles = maze.corridorTiles();
    const region = maze.corridorRegion(tiles[0].col, tiles[0].row);
    expect(region.size).toBe(tiles.length);
    expect(region.has(maze.key(SHIPPED_START.col, SHIPPED_START.row))).toBe(
      true,
    );
    expect(region.has(maze.key(0, maze.wrapRow))).toBe(true);
    expect(region.has(maze.key(GRID_COLS - 1, maze.wrapRow))).toBe(true);
  });

  it("keeps its three proportions inside their bounds", () => {
    expect(openness(maze)).toBeGreaterThanOrEqual(MAZE_OPENNESS_MIN);
    expect(openness(maze)).toBeLessThanOrEqual(MAZE_OPENNESS_MAX);
    expect(meanCorridorRun(maze)).toBeGreaterThanOrEqual(MAZE_MAZING_MIN);
    expect(meanCorridorRun(maze)).toBeLessThanOrEqual(MAZE_MAZING_MAX);
    expect(density(maze)).toBeGreaterThanOrEqual(MAZE_DENSITY_MIN);
    expect(density(maze)).toBeLessThanOrEqual(MAZE_DENSITY_MAX);
  });

  it("rests the forager on a corridor tile of the lower half", () => {
    expect(maze.isCorridor(SHIPPED_START.col, SHIPPED_START.row)).toBe(true);
    expect(SHIPPED_START.row).toBeGreaterThanOrEqual(9);
    expect(SHIPPED_START.row).toBeLessThanOrEqual(16);
  });

  it("encloses the den behind a single gate on its top edge", () => {
    expect(maze.gate).not.toBeNull();
    const gate = maze.gate as { col: number; row: number };
    expect(maze.denTiles.length).toBeGreaterThan(0);
    for (const den of maze.denTiles) {
      for (const n of maze.neighbors(den.col, den.row)) {
        expect(
          maze.isCorridor(n.col, n.row),
          `den tile (${den.col}, ${den.row}) opens onto a corridor`,
        ).toBe(false);
      }
      expect(den.row).toBeGreaterThan(gate.row);
    }
    expect(maze.isDen(gate.col, gate.row + 1)).toBe(true);
  });

  it("lets a predator reach the forager's start tile from every den tile", () => {
    const canEnter = (c: number, r: number) => maze.isDenOpen(c, r);
    for (const den of maze.denTiles) {
      const step = maze.firstStepToward(
        den.col,
        den.row,
        SHIPPED_START.col,
        SHIPPED_START.row,
        canEnter,
      );
      expect(
        step,
        `den tile (${den.col}, ${den.row}) is walled off`,
      ).not.toBeNull();
    }
  });

  it("pierces exactly one row and keeps the den off it", () => {
    let pierced = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      if (maze.isCorridor(0, r) && maze.isCorridor(GRID_COLS - 1, r)) pierced++;
    }
    expect(pierced).toBe(1);
    for (let c = 0; c < GRID_COLS; c++) {
      expect(maze.isDen(c, maze.wrapRow)).toBe(false);
      expect(maze.isGate(c, maze.wrapRow)).toBe(false);
    }
  });
});

describe("tile geometry", () => {
  it("places tile centers where the specification says", () => {
    expect(Maze.centerX(0)).toBe(GRID_ORIGIN_X + TILE / 2);
    expect(Maze.centerY(0)).toBe(GRID_ORIGIN_Y + TILE / 2);
    expect(Maze.centerX(GRID_COLS - 1)).toBe(
      GRID_ORIGIN_X + (GRID_COLS - 1) * TILE + TILE / 2,
    );
  });

  it("reads a center back as its own tile", () => {
    for (let c = 0; c < GRID_COLS; c++)
      expect(Maze.colAt(Maze.centerX(c))).toBe(c);
    for (let r = 0; r < GRID_ROWS; r++)
      expect(Maze.rowAt(Maze.centerY(r))).toBe(r);
  });
});

describe("wall autotiling", () => {
  const maze = new Maze();

  it("sums one bit per rock neighbor, with the outside counting as rock", () => {
    maze.load(board(["........", ".##.....", ".#......", "........"], 4, 4));
    // (5, 5) is rock with rock east and rock south, and corridor north and west.
    expect(maze.wallFrame(5, 5)).toBe(2 | 4);
    // (6, 5) is rock with rock west alone.
    expect(maze.wallFrame(6, 5)).toBe(8);
    // (5, 6) is rock with rock north alone.
    expect(maze.wallFrame(5, 6)).toBe(1);
    // A corner of the board counts the outside on two sides as rock.
    expect(maze.wallFrame(0, 0)).toBe(1 | 2 | 4 | 8);
  });
});

describe("posed layouts", () => {
  it("refuses a layout of the wrong size", () => {
    const maze = new Maze();
    expect(() => maze.load(["#".repeat(GRID_COLS)])).toThrow(
      /expected 18 rows/,
    );
    const short = board(["...."]);
    short[3] = short[3].slice(1);
    expect(() => maze.load(short)).toThrow(/row 3 has 35 characters/);
  });

  it("refuses a character outside the alphabet", () => {
    const maze = new Maze();
    const rows = board(["..x.."], 2, 2);
    expect(() => maze.load(rows)).toThrow(/unknown tile character/);
  });

  it("refuses a den without exactly one gate", () => {
    const maze = new Maze();
    expect(() => maze.load(board(["dd"], 4, 4))).toThrow(/exactly one gate/);
    expect(() => maze.load(board(["gg", "dd"], 4, 4))).toThrow(
      /exactly one gate/,
    );
  });

  it("accepts shapes the maze rules forbid, exactly as given", () => {
    const maze = new Maze();
    const rows = board([
      "....", // a 2x2 open block, dead ends, no den, no wrap tunnel
      "....",
      "..",
    ]);
    expect(() => maze.load(rows)).not.toThrow();
    expect(maze.rows()).toEqual(rows);
    expect(maze.gate).toBeNull();
    expect(maze.denTiles).toHaveLength(0);
    expect(maze.wrapRow).toBe(-1);
  });

  it("rests the forager on the first corridor tile in reading order", () => {
    const maze = new Maze();
    maze.load(board([".....", "....."], 5, 7));
    expect(maze.start).toEqual({ col: 7, row: 5 });
  });

  it("takes the topmost pierced row as the wrap tunnel", () => {
    const maze = new Maze();
    const rows = board([]);
    rows[4] = ".".repeat(GRID_COLS);
    rows[9] = ".".repeat(GRID_COLS);
    maze.load(rows);
    expect(maze.wrapRow).toBe(4);
    expect(maze.step(0, 4, "left")).toEqual({ col: GRID_COLS - 1, row: 4 });
    expect(maze.step(GRID_COLS - 1, 4, "right")).toEqual({ col: 0, row: 4 });
    // A second pierced row is an ordinary row: it does not wrap.
    expect(maze.step(0, 9, "left")).toEqual({ col: -1, row: 9 });
  });
});

describe("the corridor flood", () => {
  it("groups tiles by corridor distance, near before far", () => {
    const maze = new Maze();
    maze.load(board(["......"], 5, 3));
    const buckets = maze.floodBuckets(3, 5, 4);
    expect(buckets[0]).toEqual([{ col: 3, row: 5 }]);
    expect(buckets[1]).toEqual([{ col: 4, row: 5 }]);
    expect(buckets[3]).toEqual([{ col: 6, row: 5 }]);
    expect(buckets).toHaveLength(5);
  });

  it("bends around a corner and stops at rock", () => {
    const maze = new Maze();
    maze.load(board(["...", "..#", ".##"], 4, 4));
    const buckets = maze.floodBuckets(4, 6, 6);
    const reached = buckets.flat();
    expect(reached).toContainEqual({ col: 6, row: 4 });
    expect(reached).not.toContainEqual({ col: 6, row: 5 });
  });

  it("stops at the range it was given", () => {
    const maze = new Maze();
    maze.load(board(["............"], 5, 2));
    expect(maze.floodBuckets(2, 5, 3)).toHaveLength(4);
  });
});

describe("the route a hunter steers by", () => {
  it("rounds rock instead of walking into it", () => {
    const maze = new Maze();
    // A spine of rock between the hunter's row and its target's row.
    maze.load(board([".....", "####.", "....."], 6, 4));
    const canEnter = (c: number, r: number) => maze.isCorridor(c, r);
    const step = maze.firstStepToward(4, 6, 4, 8, canEnter);
    expect(step).toBe("right");
  });

  it("returns null when it already stands on the target", () => {
    const maze = new Maze();
    maze.load(board(["....."], 5, 5));
    expect(
      maze.firstStepToward(5, 5, 5, 5, (c, r) => maze.isCorridor(c, r)),
    ).toBeNull();
  });

  it("returns null when no route exists", () => {
    const maze = new Maze();
    maze.load(board(["..", "##", ".."], 4, 4));
    expect(
      maze.firstStepToward(4, 4, 4, 6, (c, r) => maze.isCorridor(c, r)),
    ).toBeNull();
  });

  it("takes the wrap tunnel when that is the shorter way", () => {
    const maze = new Maze();
    const rows = board([]);
    rows[8] = ".".repeat(GRID_COLS);
    maze.load(rows);
    const canEnter = (c: number, r: number) => maze.isCorridor(c, r);
    expect(maze.firstStepToward(1, 8, GRID_COLS - 1, 8, canEnter)).toBe("left");
  });
});
