import { describe, expect, it } from "vitest";

import { GRID_COLS, GRID_ROWS } from "./constants";
import { anchor, stampLayout } from "./fixtures";
import { TRENCH, TRENCH_START } from "./layout";
import { Maze } from "./maze";

function fixture(art: readonly string[]): Maze {
  return new Maze(stampLayout(art).rows);
}

function solidGrid(): string[] {
  return new Array<string>(GRID_ROWS).fill("#".repeat(GRID_COLS));
}

function rowWith(marks: Readonly<Record<number, string>>): string {
  const cells = new Array<string>(GRID_COLS).fill("#");
  for (const [tx, mark] of Object.entries(marks)) cells[Number(tx)] = mark;
  return cells.join("");
}

describe("loading a layout", () => {
  it("refuses a layout of the wrong height", () => {
    expect(() => new Maze(TRENCH.slice(1))).toThrow(/expected 18 rows/);
  });

  it("refuses a row of the wrong width", () => {
    const rows = [...TRENCH];
    rows[4] = rows[4].slice(1);
    expect(() => new Maze(rows)).toThrow(/row 4 has 35 characters/);
  });

  it("refuses a character outside the tile alphabet", () => {
    const rows = [...TRENCH];
    rows[3] = `X${rows[3].slice(1)}`;
    expect(() => new Maze(rows)).toThrow(/unknown tile/);
  });

  it("refuses a den carrying two gates", () => {
    const rows = solidGrid();
    rows[6] = rowWith({ 16: "g", 19: "g" });
    rows[7] = rowWith({ 16: "d", 17: "d", 18: "d", 19: "d" });
    rows[9] = rowWith({ 1: "." });
    expect(() => new Maze(rows)).toThrow(/exactly one gate/);
  });

  it("refuses a den carrying no gate", () => {
    const rows = solidGrid();
    rows[7] = rowWith({ 16: "d", 17: "d", 18: "d", 19: "d" });
    rows[9] = rowWith({ 1: "." });
    expect(() => new Maze(rows)).toThrow(/exactly one gate/);
  });

  it("rests the forager on the first corridor tile in reading order", () => {
    const board = stampLayout(["...", "...", "..."]);
    const maze = new Maze(board.rows);
    let first: { tx: number; ty: number } | null = null;
    for (let ty = 0; ty < GRID_ROWS && !first; ty++) {
      for (let tx = 0; tx < GRID_COLS && !first; tx++) {
        if (board.rows[ty][tx] === ".") first = { tx, ty };
      }
    }
    expect(maze.start).toEqual(first);
  });

  it("takes the first pierced row as the wrap tunnel", () => {
    const rows = solidGrid();
    rows[5] = `.${"#".repeat(GRID_COLS - 2)}.`;
    rows[9] = `.${"#".repeat(GRID_COLS - 2)}.`;
    expect(new Maze(rows, { tx: 0, ty: 5 }).wrapRow).toBe(5);
  });
});

describe("the ground a layout reports", () => {
  const trench = new Maze(TRENCH, TRENCH_START);

  it("tells the four kinds apart", () => {
    expect(trench.isRock(0, 0)).toBe(true);
    expect(trench.isCorridor(TRENCH_START.tx, TRENCH_START.ty)).toBe(true);
    const gate = trench.gate;
    expect(gate).not.toBeNull();
    if (gate) expect(trench.isGate(gate.tx, gate.ty)).toBe(true);
    expect(trench.denTiles.length).toBeGreaterThan(0);
  });

  it("opens the den and its gate to predators alone", () => {
    const gate = trench.gate;
    expect(gate).not.toBeNull();
    if (!gate) return;
    expect(trench.openToForager(gate.tx, gate.ty)).toBe(false);
    expect(trench.openToPredator(gate.tx, gate.ty)).toBe(true);
    const den = trench.denTiles[0];
    expect(trench.openToForager(den.tx, den.ty)).toBe(false);
    expect(trench.openToPredator(den.tx, den.ty)).toBe(true);
  });

  it("reads outside the grid as rock", () => {
    expect(trench.at(-1, 4)).toBe("#");
    expect(trench.at(GRID_COLS, 4)).toBe("#");
  });

  it("joins the two mouths of the wrap tunnel as neighbors", () => {
    const row = trench.wrapRow;
    expect(trench.step(0, row, "left")).toEqual({ tx: GRID_COLS - 1, ty: row });
    expect(trench.step(GRID_COLS - 1, row, "right")).toEqual({
      tx: 0,
      ty: row,
    });
    expect(trench.isWrapMouth(0, row)).toBe(true);
    expect(trench.isWrapMouth(1, row)).toBe(false);
  });

  it("steps off any other border into rock", () => {
    const row = trench.wrapRow === 3 ? 4 : 3;
    expect(trench.step(0, row, "left")).toEqual({ tx: -1, ty: row });
    expect(trench.isRock(-1, row)).toBe(true);
  });

  it("masks a rock tile by the rock around it", () => {
    // The top-left corner is rock with rock above, below, left and right of it.
    expect(trench.wallMask(0, 0)).toBe(1 | 2 | 4 | 8);
  });
});

describe("the corridor flood a wavefront travels", () => {
  it("groups tiles by how many steps out they lie", () => {
    const maze = fixture(["O....."]);
    const origin = anchor(stampLayout(["O....."]), "O");
    const buckets = maze.floodBuckets(origin, 4);
    expect(buckets[0]).toEqual([origin]);
    expect(buckets[1]).toEqual([{ tx: origin.tx + 1, ty: origin.ty }]);
    expect(buckets).toHaveLength(5);
  });

  it("bends around a corner rather than crossing rock", () => {
    const art = ["O#", ".#", "..", "#."];
    const board = stampLayout(art);
    const maze = new Maze(board.rows);
    const origin = anchor(board, "O");
    const buckets = maze.floodBuckets(origin, 9);
    const reached = buckets.flat();
    expect(reached).toContainEqual({ tx: origin.tx + 1, ty: origin.ty + 3 });
    expect(reached).not.toContainEqual({ tx: origin.tx + 1, ty: origin.ty });
  });

  it("enters no space rock seals off", () => {
    const board = stampLayout(["O..", "###", "..."]);
    const maze = new Maze(board.rows);
    const origin = anchor(board, "O");
    const reached = maze.floodBuckets(origin, 12).flat();
    expect(reached).toHaveLength(3);
  });
});

describe("the first step of a shortest corridor route", () => {
  it("rounds the rock between a hunter and the tile it drives at", () => {
    const art = ["P....", "####.", "F...."];
    const board = stampLayout(art);
    const maze = new Maze(board.rows);
    const from = anchor(board, "P");
    const to = anchor(board, "F");
    // Down is rock, so the route opens to the right and comes back around.
    expect(maze.firstStepToward(from, to, maze.openToForager)).toBe("right");
  });

  it("reports nothing when it is already there", () => {
    const board = stampLayout(["P.."]);
    const maze = new Maze(board.rows);
    const from = anchor(board, "P");
    expect(maze.firstStepToward(from, from, maze.openToForager)).toBeNull();
  });

  it("reports nothing when no route exists", () => {
    const board = stampLayout(["P..", "###", "..T"]);
    const maze = new Maze(board.rows);
    expect(
      maze.firstStepToward(
        anchor(board, "P"),
        anchor(board, "T"),
        maze.openToForager,
      ),
    ).toBeNull();
  });

  it("takes the wrap tunnel when that is the shorter way", () => {
    const rows = solidGrid();
    rows[7] = ".".repeat(GRID_COLS);
    const maze = new Maze(rows, { tx: 0, ty: 7 });
    const step = maze.firstStepToward(
      { tx: 1, ty: 7 },
      { tx: GRID_COLS - 2, ty: 7 },
      maze.openToForager,
    );
    expect(step).toBe("left");
  });
});
