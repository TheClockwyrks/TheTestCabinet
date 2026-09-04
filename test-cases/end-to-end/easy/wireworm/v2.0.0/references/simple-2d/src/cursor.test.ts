// The cursor: the band it is held inside, the rate it travels at, and what
// counts as something reaching it.

import { describe, expect, it } from "vitest";
import {
  CURSOR_HALF,
  CURSOR_SPEED,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  FOE_HALF,
  tileCX,
  tileCY,
} from "./constants";
import { clampCursor, cursorTouched, moveCursor } from "./cursor";
import { addFoe } from "./foes";
import { blankState } from "./flow";
import { addWorm } from "./worm";
import { toSim, type Sim } from "./sim";

function sim(): Sim {
  return toSim(blankState());
}

describe("the band", () => {
  it("holds a position inside all four bounds", () => {
    expect(clampCursor(-500, 0)).toEqual({ x: CURSOR_X_MIN, y: CURSOR_Y_MIN });
    expect(clampCursor(9000, 9000)).toEqual({
      x: CURSOR_X_MAX,
      y: CURSOR_Y_MAX,
    });
    expect(clampCursor(640, 688)).toEqual({ x: 640, y: 688 });
  });
});

describe("moving", () => {
  it("travels at the same rate on either axis", () => {
    const s = sim();
    s.cursor.x = 640;
    moveCursor(s, 1, 0, 0.5);
    expect(s.cursor.x).toBeCloseTo(640 + CURSOR_SPEED * 0.5, 6);

    s.cursor.y = CURSOR_Y_MAX;
    moveCursor(s, 0, -1, 0.02);
    expect(s.cursor.y).toBeCloseTo(CURSOR_Y_MAX - CURSOR_SPEED * 0.02, 6);
  });

  it("splits the rate across the diagonal", () => {
    const s = sim();
    s.cursor.x = 640;
    s.cursor.y = CURSOR_Y_MAX;
    moveCursor(s, 1, -1, 0.02);
    expect(s.cursor.x - 640).toBeCloseTo((CURSOR_SPEED / Math.SQRT2) * 0.02, 6);
  });

  it("stands still when opposite movements cancel", () => {
    const s = sim();
    s.cursor.x = 640;
    moveCursor(s, 0, 0, 1);
    expect(s.cursor.x).toBe(640);
  });
});

describe("contact", () => {
  it("is an overlap of the two boxes for a foe", () => {
    const s = sim();
    s.cursor.x = 640;
    s.cursor.y = 688;
    const foe = addFoe(s, "glitch", 640 + CURSOR_HALF + FOE_HALF, 688);
    expect(cursorTouched(s)).toBe(true);
    foe.x = 640 + CURSOR_HALF + FOE_HALF + 1;
    expect(cursorTouched(s)).toBe(false);
  });

  it("is an overlap of the tile and the box for a segment", () => {
    const s = sim();
    s.cursor.x = tileCX(20);
    s.cursor.y = tileCY(19);
    addWorm(s, 20, 19);
    expect(cursorTouched(s)).toBe(true);

    s.worms[0]!.segments[0] = { c: 24, r: 19 };
    expect(cursorTouched(s)).toBe(false);
  });

  it("finds nothing on an empty board", () => {
    expect(cursorTouched(sim())).toBe(false);
  });
});
