// The strait's geometry, against the figures `specs/strait.md` states.

import { describe, expect, it } from "vitest";
import {
  BAYS,
  BAY_COUNT,
  COLS,
  ICE_BOTTOM,
  ICE_TOP,
  ROWS,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  STRAIT_TOP,
  TILE,
  WATER_BOTTOM,
  WATER_TOP,
  colAt,
  inBounds,
  rowAt,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "./constants";
import {
  DIRECTIONS,
  bayCenterX,
  bayColumns,
  bayIndexAtCol,
  facingBetween,
  facingDX,
  facingDY,
  isWaterRow,
  itemKind,
  rowsAdvanced,
  tileDistance,
} from "./grid";

describe("the tile-to-stage map", () => {
  it("is the six forms specs/strait.md states", () => {
    expect(tileLeft(0)).toBe(0);
    expect(tileLeft(39)).toBe(1248);
    expect(tileTop(0)).toBe(STRAIT_TOP);
    expect(tileTop(19)).toBe(80 + 32 * 19);
    expect(tileCX(20)).toBe(32 * 20 + 16);
    expect(tileCY(19)).toBe(80 + 32 * 19 + 16);
    expect(colAt(tileCX(7))).toBe(7);
    expect(rowAt(tileCY(7))).toBe(7);
  });

  it("inverts on every tile of the grid", () => {
    for (let col = 0; col < COLS; col += 1) {
      expect(colAt(tileCX(col))).toBe(col);
      expect(colAt(tileLeft(col))).toBe(col);
      expect(colAt(tileLeft(col) + TILE - 1)).toBe(col);
    }
    for (let row = 0; row < ROWS; row += 1) {
      expect(rowAt(tileCY(row))).toBe(row);
      expect(rowAt(tileTop(row))).toBe(row);
    }
  });

  it("bounds the grid at 40 by 20", () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(COLS - 1, ROWS - 1)).toBe(true);
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(COLS, 0)).toBe(false);
    expect(inBounds(0, -1)).toBe(false);
    expect(inBounds(0, ROWS)).toBe(false);
  });
});

describe("the five bands", () => {
  it("puts the eight water rows where the table does", () => {
    const water = [];
    for (let row = 0; row < ROWS; row += 1) {
      if (isWaterRow(row)) water.push(row);
    }
    expect(water).toEqual([WATER_TOP, 3, 4, 5, 6, 7, 8, WATER_BOTTOM]);
    expect(water).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("stacks the five bands in the order specs/strait.md fixes", () => {
    expect([ROW_CAP, ROW_BAYS]).toEqual([0, 1]);
    expect([WATER_TOP, WATER_BOTTOM]).toEqual([2, 9]);
    expect(ROW_MEDIAN).toBe(10);
    expect([ICE_TOP, ICE_BOTTOM]).toEqual([11, 18]);
    expect(ROW_NEAR).toBe(19);
  });
});

describe("the five bays", () => {
  it("occupies exactly the ten columns BAYS names", () => {
    const columns = new Set<number>();
    for (const [left, right] of BAYS) {
      columns.add(left);
      columns.add(right);
    }
    expect(columns.size).toBe(2 * BAY_COUNT);
    for (let col = 0; col < COLS; col += 1) {
      expect(bayIndexAtCol(col) >= 0).toBe(columns.has(col));
    }
  });

  it("centers a bay between its two columns", () => {
    for (let bay = 0; bay < BAY_COUNT; bay += 1) {
      const [left, right] = bayColumns(bay);
      expect(right).toBe(left + 1);
      expect(bayCenterX(bay)).toBe(tileLeft(left) + TILE);
    }
  });
});

describe("directions", () => {
  it("offsets each facing by one tile", () => {
    expect(DIRECTIONS).toEqual(["up", "down", "left", "right"]);
    expect([facingDX("up"), facingDY("up")]).toEqual([0, -1]);
    expect([facingDX("down"), facingDY("down")]).toEqual([0, 1]);
    expect([facingDX("left"), facingDY("left")]).toEqual([-1, 0]);
    expect([facingDX("right"), facingDY("right")]).toEqual([1, 0]);
  });

  it("names the facing between two neighboring tiles", () => {
    expect(facingBetween(5, 5, 5, 4)).toBe("up");
    expect(facingBetween(5, 5, 5, 6)).toBe("down");
    expect(facingBetween(5, 5, 4, 5)).toBe("left");
    expect(facingBetween(5, 5, 6, 5)).toBe("right");
  });

  it("measures tile distance as the sum of the differences", () => {
    expect(tileDistance(0, 0, 0, 0)).toBe(0);
    expect(tileDistance(3, 4, 6, 9)).toBe(8);
  });
});

describe("derived readings", () => {
  it("counts the rows a crossing has advanced from its best row", () => {
    expect(rowsAdvanced(ROW_NEAR)).toBe(0);
    expect(rowsAdvanced(ROW_NEAR - 3)).toBe(3);
    expect(rowsAdvanced(ROW_BAYS)).toBe(18);
  });

  it("accepts the six lane item kinds and refuses anything else", () => {
    for (const kind of ["plow", "dogsled", "car", "pan", "raft3", "raft4"]) {
      expect(itemKind(kind)).toBe(kind);
    }
    expect(() => itemKind("sledge")).toThrow(/not a lane item kind/);
  });
});
