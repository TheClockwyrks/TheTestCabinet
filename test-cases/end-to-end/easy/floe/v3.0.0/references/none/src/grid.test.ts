// The strait's geometry: the one tile-to-stage map the whole game is written in,
// the five bands, the five bays, and the footing each band gives the critter.

import { describe, expect, it } from "vitest";
import {
  BAYS,
  BAY_COUNT,
  COLS,
  HUD_H,
  ICE_BOTTOM,
  ICE_TOP,
  ROWS,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  STAGE_H,
  STAGE_W,
  STRAIT_H,
  STRAIT_TOP,
  STRAIT_W,
  START_COL,
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
  bayCenterX,
  bayColumns,
  bayIndexAtCol,
  facingDX,
  facingDY,
  isWaterRow,
  rowsAdvanced,
  tileDistance,
} from "./grid";
import { harness, startCrossing } from "./harness.test-support";

describe("the stage", () => {
  it("stacks the HUD bar above the strait, and the two fill it", () => {
    expect([STAGE_W, STAGE_H]).toEqual([1280, 720]);
    expect(HUD_H).toBe(80);
    expect(STRAIT_TOP).toBe(HUD_H);
    expect(STRAIT_TOP + STRAIT_H).toBe(STAGE_H);
    expect(STRAIT_W).toBe(STAGE_W);
    expect(COLS * TILE).toBe(STRAIT_W);
    expect(ROWS * TILE).toBe(STRAIT_H);
  });
});

describe("the tile-to-stage map", () => {
  it("puts every tile where the six conversions say", () => {
    for (const col of [0, 1, 19, 20, 39]) {
      expect(tileLeft(col)).toBe(32 * col);
      expect(tileCX(col)).toBe(32 * col + 16);
    }
    for (const row of [0, 1, 10, 11, 19]) {
      expect(tileTop(row)).toBe(80 + 32 * row);
      expect(tileCY(row)).toBe(80 + 32 * row + 16);
    }
  });

  it("reads a stage position back to the tile it falls in", () => {
    for (let col = 0; col < COLS; col += 1) {
      expect(colAt(tileLeft(col))).toBe(col);
      expect(colAt(tileCX(col))).toBe(col);
      expect(colAt(tileLeft(col + 1) - 0.001)).toBe(col);
    }
    for (let row = 0; row < ROWS; row += 1) {
      expect(rowAt(tileTop(row))).toBe(row);
      expect(rowAt(tileCY(row))).toBe(row);
      expect(rowAt(tileTop(row + 1) - 0.001)).toBe(row);
    }
    expect(colAt(-1)).toBe(-1);
    expect(rowAt(STRAIT_TOP - 1)).toBe(-1);
  });

  it("puts a tile outside the grid outside the strait", () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(COLS - 1, ROWS - 1)).toBe(true);
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(COLS, 0)).toBe(false);
    expect(inBounds(0, -1)).toBe(false);
    expect(inBounds(0, ROWS)).toBe(false);
  });
});

describe("the five bands", () => {
  it("stacks them in the order the strait names them", () => {
    expect(ROW_CAP).toBe(0);
    expect(ROW_BAYS).toBe(1);
    expect([WATER_TOP, WATER_BOTTOM]).toEqual([2, 9]);
    expect(ROW_MEDIAN).toBe(10);
    expect([ICE_TOP, ICE_BOTTOM]).toEqual([11, 18]);
    expect(ROW_NEAR).toBe(19);
    expect(START_COL).toBe(20);
  });

  it("counts only the water band's rows as water", () => {
    for (let row = 0; row < ROWS; row += 1) {
      expect(isWaterRow(row)).toBe(row >= WATER_TOP && row <= WATER_BOTTOM);
    }
  });

  it("gives the critter the footing of the band it stands on", () => {
    const h = harness();
    startCrossing(h);
    const footing = (col: number, row: number): string => {
      h.api.setCritterTile(col, row);
      return h.api.snapshot().critter.footing;
    };
    expect(footing(START_COL, ROW_NEAR)).toBe("solid");
    expect(footing(START_COL, ROW_MEDIAN)).toBe("solid");
    expect(footing(3, ROW_BAYS)).toBe("solid");
    expect(footing(3, ROW_CAP)).toBe("solid");
    for (let row = ICE_TOP; row <= ICE_BOTTOM; row += 1) {
      expect(footing(START_COL, row)).toBe("solid");
    }
    for (let row = WATER_TOP; row <= WATER_BOTTOM; row += 1) {
      expect(footing(START_COL, row)).toBe("water");
    }
  });

  it("carries no lane item on the near shore or the median at any level", () => {
    for (const level of [1, 4, 8]) {
      const h = harness();
      h.api.reset();
      h.api.setLevel(level);
      const s = h.api.snapshot();
      for (const item of [...s.vehicles, ...s.floes]) {
        expect(item.row).not.toBe(ROW_NEAR);
        expect(item.row).not.toBe(ROW_MEDIAN);
      }
      for (const lane of [...s.iceLanes, ...s.waterLanes]) {
        expect(lane.row).not.toBe(ROW_NEAR);
        expect(lane.row).not.toBe(ROW_MEDIAN);
      }
    }
  });
});

describe("the five bays", () => {
  it("cuts them into the bay row at the stated column pairs", () => {
    expect(BAY_COUNT).toBe(5);
    expect(BAYS).toEqual([
      [3, 4],
      [11, 12],
      [19, 20],
      [27, 28],
      [35, 36],
    ]);
    for (let bay = 0; bay < BAY_COUNT; bay += 1) {
      const [left, right] = bayColumns(bay);
      expect(right).toBe(left + 1);
      expect(bayIndexAtCol(left)).toBe(bay);
      expect(bayIndexAtCol(right)).toBe(bay);
      expect(bayCenterX(bay)).toBe(tileLeft(right));
    }
  });

  it("leaves every other column of the bay row solid", () => {
    const inABay = new Set(BAYS.flatMap(([left, right]) => [left, right]));
    for (let col = 0; col < COLS; col += 1) {
      expect(bayIndexAtCol(col) >= 0).toBe(inABay.has(col));
    }
  });
});

describe("the grid's readings", () => {
  it("gives each facing its one-tile offset", () => {
    expect([facingDX("up"), facingDY("up")]).toEqual([0, -1]);
    expect([facingDX("down"), facingDY("down")]).toEqual([0, 1]);
    expect([facingDX("left"), facingDY("left")]).toEqual([-1, 0]);
    expect([facingDX("right"), facingDY("right")]).toEqual([1, 0]);
  });

  it("measures tile distance as the sum of the two differences", () => {
    expect(tileDistance(0, 0, 0, 0)).toBe(0);
    expect(tileDistance(0, 0, 3, 4)).toBe(7);
    expect(tileDistance(5, 9, 2, 1)).toBe(11);
  });

  it("counts a crossing's advance from the near shore", () => {
    expect(rowsAdvanced(ROW_NEAR)).toBe(0);
    expect(rowsAdvanced(ROW_NEAR - 3)).toBe(3);
    expect(rowsAdvanced(ROW_BAYS)).toBe(18);
  });
});
