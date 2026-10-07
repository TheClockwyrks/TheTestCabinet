// building/preview-follows-the-pointer — a pointer move over the floor centres
// the held footprint on the pointer, at every footprint size.
//
// specs/building.md, The preview follows the pointer: with the pointer at
// `(x, y)` in logical stage units and the held type's footprint `size` tiles on
// a side,
//
//   col = clamp(round((x - FLOOR_X0) / TILE - size / 2), 0, COLS - size)
//   row = clamp(round((y - FLOOR_Y0) / TILE - size / 2), 0, ROWS - size)
//
// with `round` rounding a half upward. `previewAnchor` below is that formula and
// nothing else, so what is asserted is the specification rather than the
// reference.
//
// The pointer is driven through a REAL `pointermove` at the engine's own event
// target, because the requirement is about the pointer.
//
// TWO POINTS, ON PURPOSE. Both lie far inside the floor, so the clamp is inert
// and the reading is about the centring alone — `building/preview-clamped-to-the-grid`
// is where the clamp is exercised. One sits on a tile CENTRE, which lands the
// even sizes exactly on a half and so reads differently under every rounding
// rule but the stated one; the other sits off-centre, where an implementation
// that floored or truncated instead of rounding reads a different tile.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { COLS, FLOOR_X0, FLOOR_Y0, ROWS, TILE } from "../constants";
import {
  captureStill,
  createHarness,
  movePointerTo,
  sizeOf,
  startRun,
  tileCenter,
  type Harness,
  type TowerType,
} from "../harness";
import { heldPreview } from "./preview";

/** One type per footprint size: 2x2, 3x3 and 4x4. */
const HELD: readonly TowerType[] = ["arc", "bloom", "lance"];

/** Enough money that affordability never enters the reading. */
const PURSE = 1000;

/** `clamp(v, lo, hi)`, exactly as specs/building.md defines it. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** specs/building.md's preview formula, written out. */
function previewAnchor(
  size: number,
  x: number,
  y: number,
): { col: number; row: number } {
  return {
    col: clamp(Math.round((x - FLOOR_X0) / TILE - size / 2), 0, COLS - size),
    row: clamp(Math.round((y - FLOOR_Y0) / TILE - size / 2), 0, ROWS - size),
  };
}

/** A tile centre deep inside the floor: every size lands on a half here. */
const ON_CENTRE = tileCenter(20, 12);

/** A point three units into tile (30, 22), so no size lands on a half. */
const OFF_CENTRE = {
  x: FLOOR_X0 + 30 * TILE + 3,
  y: FLOOR_Y0 + 22 * TILE + 3,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("centres the held footprint on the pointer at every size", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  for (const type of HELD) {
    const size = sizeOf(type);
    for (const at of [ON_CENTRE, OFF_CENTRE]) {
      h.debug.setArmed(type);
      await movePointerTo(h, at.x, at.y);

      const build = heldPreview(h);
      const want = previewAnchor(size, at.x, at.y);
      const where = `${type} (${size}x${size}) under the pointer at (${at.x}, ${at.y})`;
      assertEqual(build.col, want.col, `${where}: the footprint's column`);
      assertEqual(build.row, want.row, `${where}: the footprint's row`);
    }
  }

  // The last frame that ran drew the 4x4 preview under the pointer.
  captureStill(h, "following");
});
