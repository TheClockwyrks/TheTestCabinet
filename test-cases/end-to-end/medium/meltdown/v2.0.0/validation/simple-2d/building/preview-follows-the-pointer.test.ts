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
// THE POINTER IS THE SUBJECT, so the move goes through the ENGINE's own pointer
// input and a frame is run to deliver it — see `movePointerTo`. That is the path
// a player's finger takes, and it is the same path whether a build resolves the
// sample where it arrives or reads the position back at the top of its update.
//
// THREE POINTS, ON PURPOSE, AND ALL THREE FAR INSIDE THE FLOOR so the clamp is
// inert and the reading is about the centring alone — `preview-clamped-to-the-grid`
// is where the clamp is exercised. Each is a whole number of logical units, so
// nothing between the check and the game rounds the pointer before the formula
// sees it, and between them the nine readings separate every rounding rule a
// build might have written:
//
//   ON_EDGE lands the 3x3 exactly on a half, which is the only footprint size a
//   whole-number pointer CAN land on a half at all on a 19-unit tile, so it is
//   where rounding a half upward is told from rounding it downward.
//   BELOW_HALF sits just under the middle of a tile and ABOVE_HALF just over it,
//   so across the three sizes a build that floored, truncated or ceilinged reads
//   a different tile from the one the formula gives at six of the nine readings.

import { afterEach, beforeEach, it } from "vitest";
import {
  COLS,
  FLOOR_X0,
  FLOOR_Y0,
  ROWS,
  TILE,
  tileLeft,
  tileTop,
} from "../constants";
import { assertEqual } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { heldPreview, movePointerTo } from "./preview";

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

/** A tile's own top-left corner, deep inside the floor: the 3x3 lands on a half. */
const ON_EDGE = { x: tileLeft(20), y: tileTop(12) };

/** Nine units into tile (30, 22): every size lands just below a half. */
const BELOW_HALF = { x: tileLeft(30) + 9, y: tileTop(22) + 9 };

/** Ten units into the same tile: every size lands just above a half. */
const ABOVE_HALF = { x: tileLeft(30) + 10, y: tileTop(22) + 10 };

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
    for (const at of [ON_EDGE, BELOW_HALF, ABOVE_HALF]) {
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
