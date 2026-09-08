// building/preview-invalid-off-the-grid — a footprint that would run past the
// floor's edge is never committed clipped.
//
// specs/building.md fixes two rules that meet here. The preview a POINTER carries
// is "clamped so that the whole footprint stays on the grid", and a footprint is
// valid only when "every tile of the footprint is on the grid" (condition 1);
// specs/floor.md adds that the casing is not part of the tile grid and that no
// tower footprint ever covers any part of it. specs/instrumentation.md separates
// the two: `setPreview` is a POSE and moves the footprint's top-left "exactly
// where the call names it", and "a footprint hanging off the grid is one the
// placement check answers `false` for".
//
// SO A BUILD HANDED A TOP-LEFT WHOSE BLOCK WOULD RUN PAST THE FAR EDGE HOLDS THE
// FOOTPRINT AS ASKED AND REPORTS IT INVALID. This check still accepts a clamp as
// well, because a build that clamped would be wrong about `setPreview` rather
// than about this requirement, and `instrumentation/poses-read-back-the-build` is
// where that is decided. What no build may do is COMMIT it — a tower standing
// partly off the grid, out over the casing, is the defect this item exists to
// catch — and that is asserted directly against the roster after the placement is
// attempted.
//
// A 4x4 Lance is used because it is the largest footprint, so the anchor asked for
// below runs three columns and three rows past the last tile.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { COLS, ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview, sizeOf } from "./preview";

/** The largest footprint, so the overhang asked for is unmistakable. */
const HELD = "lance";
const SIZE = sizeOf(HELD);

/**
 * The top-left asked for: the floor's very last tile. A `SIZE x SIZE` block
 * anchored there would cover columns up to `COLS + SIZE - 2` and rows up to
 * `ROWS + SIZE - 2`, every one of them off the grid.
 */
const ASK_COL = COLS - 1;
const ASK_ROW = ROWS - 1;

/** Far above the Lance's cost, so affordability is never what decides this. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("never commits a footprint that would run past the floor's edge", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  await h.debug.setArmed(HELD);
  await h.debug.setPreview(ASK_COL, ASK_ROW);
  const build = await heldPreview(h);

  const wholly =
    build.col >= 0 &&
    build.row >= 0 &&
    build.col <= COLS - SIZE &&
    build.row <= ROWS - SIZE;
  if (!wholly) {
    // The footprint was held as asked, so condition 1 has to fail it.
    assertEqual(
      build.valid,
      false,
      `a ${SIZE}x${SIZE} footprint held at (${build.col}, ${build.row}), whose ` +
        "block runs off the grid",
    );
  }

  await h.debug.place();
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "invalid");

  for (const tower of after.towers) {
    const where = `the ${tower.type} the placement left at (${tower.col}, ${tower.row})`;
    assertBetween(tower.col, 0, COLS - tower.size, `${where}: its column`);
    assertBetween(tower.row, 0, ROWS - tower.size, `${where}: its row`);
  }
});
