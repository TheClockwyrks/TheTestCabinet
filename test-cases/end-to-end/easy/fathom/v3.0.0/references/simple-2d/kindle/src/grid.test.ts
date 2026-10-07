import { describe, expect, it } from "vitest";
import { GRID_ORIGIN_X, GRID_ORIGIN_Y, TILE } from "./constants";
import {
  centerX,
  centerY,
  columnAt,
  distance,
  opposite,
  perpendicular,
  rowAt,
  segmentDistance,
  tileAtIndex,
  tileIndex,
} from "./grid";

describe("the tile grid", () => {
  it("places a tile center where specs/overview.md says it is", () => {
    expect(centerX(0)).toBe(GRID_ORIGIN_X + TILE / 2);
    expect(centerY(0)).toBe(GRID_ORIGIN_Y + TILE / 2);
    expect(centerX(35)).toBe(GRID_ORIGIN_X + 35 * TILE + TILE / 2);
  });

  it("reads a tile back from a point inside it", () => {
    for (let tx = 0; tx < 36; tx++) {
      expect(columnAt(centerX(tx))).toBe(tx);
      expect(columnAt(centerX(tx) - TILE / 2)).toBe(tx);
      expect(columnAt(centerX(tx) + TILE / 2 - 0.001)).toBe(tx);
    }
    for (let ty = 0; ty < 18; ty++) expect(rowAt(centerY(ty))).toBe(ty);
  });

  it("round-trips a tile through its flat index", () => {
    expect(tileAtIndex(tileIndex(7, 11))).toEqual({ tx: 7, ty: 11 });
  });

  it("names the directions that face and cross one another", () => {
    expect(opposite("up")).toBe("down");
    expect(opposite("left")).toBe("right");
    expect(perpendicular("up", "left")).toBe(true);
    expect(perpendicular("up", "down")).toBe(false);
    expect(perpendicular("up", "up")).toBe(false);
  });

  it("measures the distance from a point to a segment", () => {
    expect(segmentDistance(0, 10, -100, 0, 100, 0)).toBeCloseTo(10);
    // Past the end of the segment, the distance is to the end itself.
    expect(segmentDistance(200, 0, -100, 0, 100, 0)).toBeCloseTo(100);
    expect(distance(0, 0, 3, 4)).toBeCloseTo(5);
  });
});
