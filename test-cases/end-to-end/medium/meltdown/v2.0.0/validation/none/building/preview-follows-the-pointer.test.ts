// building/preview-follows-the-pointer — a pointer move over the floor centres
// the held footprint on the pointer, at every footprint size.
//
// specs/building.md, The preview follows the pointer: with the pointer at
// `(x, y)` in logical stage units and the held type's footprint `size` tiles on a
// side,
//
//   col = clamp(round((x - FLOOR_X0) / TILE - size / 2), 0, COLS - size)
//   row = clamp(round((y - FLOOR_Y0) / TILE - size / 2), 0, ROWS - size)
//
// with `round` rounding a half upward and `clamp(v, lo, hi) = min(max(v, lo), hi)`.
// `previewAnchor` below is that formula written out and nothing else, so what is
// asserted is the specification rather than the reference.
//
// TWO POINTS, ON PURPOSE, AND BOTH FAR INSIDE THE FLOOR so the clamp is inert and
// the reading is about the centring alone — `building/preview-clamped-to-the-grid`
// is where the clamp is exercised. One sits on a tile CENTRE, which lands the even
// sizes exactly on a half and so reads differently under every rounding rule but
// the stated one; the other sits three units into a tile, where an implementation
// that floored or truncated instead of rounding reads a different tile at every
// size.
//
// THE POINTER IS THE SUBJECT, so it is moved through `pointerMove`, which
// `specs/instrumentation.md` says "feed the same pointer input path the runtime
// feeds", and a frame is run to answer it — see `movePointerTo`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  COLS,
  FLOOR_X0,
  FLOOR_Y0,
  ROWS,
  TILE,
  tileCX,
  tileCY,
  type TowerType,
} from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview, movePointerTo, sizeOf } from "./preview";

/** One type per footprint size: the Arc is 2x2, the Bloom 3x3, the Lance 4x4. */
const HELD: readonly TowerType[] = ["arc", "bloom", "lance"];

/** Enough money that affordability never enters this reading. */
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

/** A tile centre deep inside the floor: every even size lands on a half here. */
const ON_CENTRE = { x: tileCX(20), y: tileCY(12) };

/** Three units into tile (30, 22), so no size lands on a half. */
const OFF_CENTRE = {
  x: FLOOR_X0 + 30 * TILE + 3,
  y: FLOOR_Y0 + 22 * TILE + 3,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("centres the held footprint on the pointer at every size", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  for (const type of HELD) {
    const size = sizeOf(type);
    for (const at of [ON_CENTRE, OFF_CENTRE]) {
      await h.debug.setArmed(type);
      await movePointerTo(h, at.x, at.y);

      const build = await heldPreview(h);
      const want = previewAnchor(size, at.x, at.y);
      const where = `${type} (${size}x${size}) under the pointer at (${at.x}, ${at.y})`;
      assertEqual(build.col, want.col, `${where}: the footprint's column`);
      assertEqual(build.row, want.row, `${where}: the footprint's row`);
    }
  }

  // The last frame that ran drew the 4x4 preview under the pointer.
  await captureStill(h, "following");
});
