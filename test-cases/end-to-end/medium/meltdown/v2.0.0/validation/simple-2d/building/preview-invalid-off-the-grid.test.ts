// building/preview-invalid-off-the-grid — a footprint that would run past the
// floor's edge is never committed clipped.
//
// specs/building.md fixes two rules that meet here. The held preview is "clamped
// so that the whole footprint stays on the grid", and a footprint is valid only
// when "every tile of the footprint is on the grid" (condition 1); specs/floor.md
// adds that the casing is not part of the tile grid and that no tower footprint
// ever covers any part of it. specs/instrumentation.md says the same of the
// operation used here: `setPreview` moves the held preview, "clamped to keep the
// footprint on the grid".
//
// SO A BUILD HANDED A TOP-LEFT WHOSE BLOCK WOULD RUN PAST THE FAR EDGE HAS EXACTLY
// TWO CONFORMANT ANSWERS, and this check accepts either: clamp the footprint back
// onto the grid, which is what the preview rule says, or hold the footprint as
// asked and report it INVALID, which is what condition 1 says. What no build may
// do is COMMIT it — a tower standing partly off the grid, out over the casing, is
// the defect this item exists to catch — and that is asserted directly against the
// roster after the placement is attempted.
//
// A 4x4 Lance is used because it is the largest footprint, so the anchor asked for
// below runs three columns and three rows past the last tile.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, ROWS } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview } from "./preview";

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

afterEach(() => {
  h?.dispose();
});

it("never commits a footprint that would run past the floor's edge", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  h.debug.setArmed(HELD);
  h.debug.setPreview(ASK_COL, ASK_ROW);
  const build = heldPreview(h);

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

  h.debug.place();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "invalid");

  for (const tower of after.towers) {
    const where = `the ${tower.type} the placement left at (${tower.col}, ${tower.row})`;
    assertBetween(tower.col, 0, COLS - tower.size, `${where}: its column`);
    assertBetween(tower.row, 0, ROWS - tower.size, `${where}: its row`);
  }
});
