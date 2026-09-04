import { describe, expect, it } from "vitest";
import {
  BOTTOM_EXHAUST_COLS,
  COLS,
  FLOOR_X1,
  FLOOR_Y1,
  LEFT_VENT_ROWS,
  MIN_TOUCH_TARGET,
  OPPOSITE,
  PANEL_W,
  PANEL_X,
  REACTOR_W,
  RIGHT_EXHAUST_ROWS,
  ROWS,
  STAGE_H,
  STAGE_W,
  TILE,
  TOP_VENT_COLS,
  footprintCentre,
  heatMultiplier,
  inBounds,
  tileCX,
  tileCY,
  tileLeft,
  tileOfX,
  tileOfY,
  tileTop,
} from "./constants";

describe("the stage and the floor", () => {
  it("splits the stage into the reactor and the panel", () => {
    expect(STAGE_W).toBe(1280);
    expect(STAGE_H).toBe(720);
    expect(REACTOR_W).toBe(986);
    expect(PANEL_X).toBe(986);
    expect(PANEL_W).toBe(294);
    expect(PANEL_X + PANEL_W).toBe(STAGE_W);
  });

  it("fills the floor rectangle exactly with the tile grid", () => {
    expect(FLOOR_X1).toBe(968);
    expect(FLOOR_Y1).toBe(702);
    expect(COLS * TILE).toBe(950);
    expect(ROWS * TILE).toBe(684);
  });

  it("places a tile's corner and its centre where the map says", () => {
    expect(tileLeft(0)).toBe(18);
    expect(tileTop(0)).toBe(18);
    expect(tileCX(0)).toBe(27.5);
    expect(tileCY(0)).toBe(27.5);
    expect(tileCX(7)).toBe(18 + 19 * 7 + 9.5);
    expect(tileCY(31)).toBe(18 + 19 * 31 + 9.5);
  });

  it("reads a tile back from a centre", () => {
    for (const c of [0, 1, 17, 49]) {
      expect(tileOfX(tileCX(c))).toBe(c);
    }
    for (const r of [0, 1, 22, 35]) {
      expect(tileOfY(tileCY(r))).toBe(r);
    }
  });

  it("knows what lies on the grid", () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(49, 35)).toBe(true);
    expect(inBounds(50, 0)).toBe(false);
    expect(inBounds(0, 36)).toBe(false);
    expect(inBounds(-1, 4)).toBe(false);
  });

  it("centres a footprint on its own block, whatever its size", () => {
    expect(footprintCentre(0, 0, 2)).toEqual({ x: 37, y: 37 });
    expect(footprintCentre(10, 10, 4)).toEqual({
      x: tileLeft(10) + 38,
      y: tileTop(10) + 38,
    });
  });
});

describe("the openings", () => {
  it("runs both side openings over rows 16 to 19", () => {
    expect([...LEFT_VENT_ROWS]).toEqual([16, 17, 18, 19]);
    expect([...RIGHT_EXHAUST_ROWS]).toEqual([16, 17, 18, 19]);
  });

  it("runs both top and bottom openings over columns 22 to 29", () => {
    expect([...TOP_VENT_COLS]).toEqual([22, 23, 24, 25, 26, 27, 28, 29]);
    expect([...BOTTOM_EXHAUST_COLS]).toEqual([22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it("assigns each vent the exhaust across the floor from it", () => {
    expect(OPPOSITE.left).toBe("right");
    expect(OPPOSITE.top).toBe("bottom");
  });
});

describe("the damage curve", () => {
  it("is at its floor cold and its ceiling at the redline", () => {
    expect(heatMultiplier(0, 80)).toBeCloseTo(0.35, 10);
    expect(heatMultiplier(80, 80)).toBeCloseTo(3.5, 10);
  });

  it("holds flat from the redline up to the trip", () => {
    expect(heatMultiplier(90, 80)).toBeCloseTo(3.5, 10);
    expect(heatMultiplier(100, 80)).toBeCloseTo(3.5, 10);
  });

  it("climbs quadratically, so half the redline is not half the power", () => {
    expect(heatMultiplier(40, 80)).toBeCloseTo(1.1375, 10);
    expect(heatMultiplier(50, 100)).toBeCloseTo(1.1375, 10);
  });

  it("gives a Rime nothing but the curve, because its redline is the trip", () => {
    expect(heatMultiplier(100, 100)).toBeCloseTo(3.5, 10);
    expect(heatMultiplier(50, 100)).toBeLessThan(heatMultiplier(50, 60));
  });
});

describe("the panel's own floor for a control", () => {
  it("is 32 logical units", () => {
    expect(MIN_TOUCH_TARGET).toBe(32);
  });
});
