// building/preview-clamped-to-the-grid — a pointer at any corner of the floor
// still leaves the whole held footprint on the grid.
//
// specs/building.md, The preview follows the pointer: the footprint is "clamped so
// that the whole footprint stays on the grid", and "the clamp is why a pointer at
// any corner of the floor still leaves the whole footprint on the grid at every
// size".
//
// WHAT IS ASSERTED IS THAT STATED CONSEQUENCE and not the formula that produces
// it — `building/preview-follows-the-pointer` decides the formula. A footprint of
// side `size` anchored at `(col, row)` lies wholly on the grid exactly when
// `0 <= col <= COLS - size` and `0 <= row <= ROWS - size` (specs/floor.md), so
// those are the bounds each of the eight readings is held to.
//
// THE FOUR CORNERS ARE THE FOUR CORNER TILES' CENTRES, which are unambiguously on
// the floor: the specification fixes the floor's rectangle but not which side of
// its far edge a point lying exactly on that edge falls, so a probe placed there
// would be measuring an unstated boundary rather than the clamp. The two sizes are
// the smallest and the largest, because the clamp bites hardest at 4x4 and a build
// that clamped for a 2x2 alone passes the first and fails the second.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, ROWS, tileCX, tileCY } from "../constants";
import { assertBetween } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { heldPreview, movePointerTo } from "./preview";

/** The smallest footprint and the largest: 2x2 and 4x4. */
const HELD: readonly TowerType[] = ["arc", "lance"];

/** Enough money that affordability never enters this reading. */
const PURSE = 1000;

/** The centres of the floor's four corner tiles. */
const CORNERS = [
  { name: "top-left", x: tileCX(0), y: tileCY(0) },
  { name: "top-right", x: tileCX(COLS - 1), y: tileCY(0) },
  { name: "bottom-left", x: tileCX(0), y: tileCY(ROWS - 1) },
  { name: "bottom-right", x: tileCX(COLS - 1), y: tileCY(ROWS - 1) },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the whole footprint on the grid at every corner of the floor", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  for (const type of HELD) {
    const size = sizeOf(type);
    for (const corner of CORNERS) {
      h.debug.setArmed(type);
      await movePointerTo(h, corner.x, corner.y);

      const build = heldPreview(h);
      const where = `${type} (${size}x${size}) at the floor's ${corner.name} corner`;
      assertBetween(
        build.col,
        0,
        COLS - size,
        `${where}: the footprint's column`,
      );
      assertBetween(build.row, 0, ROWS - size, `${where}: the footprint's row`);
    }
  }

  // The last frame that ran drew the 4x4 preview clamped into the far corner.
  captureStill(h, "clamped");
});
