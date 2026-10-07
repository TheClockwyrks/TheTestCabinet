// hopping/refuse-below-near-shore — a hop below the near shore is refused.
//
// The bottom edge of the same rule `refuse-left-edge` and `refuse-right-edge`
// decide along the other axis: `specs/hopping.md` refuses a hop whose target tile
// "is outside the grid: `inBounds(col, row)` is false", and `specs/strait.md`
// fixes `ROWS` (`20`) with "row `19` the bottom row the critter starts on"
// (`ROW_NEAR`). A hop down from row `19` targets row `20` and is refused, leaving
// "everything as it was: the critter stays where it stands ... no life is lost".
//
// It is its own item because this is the edge a player leans on constantly — the
// near shore is where every crossing begins and where a critter retreats to — and
// a build that clamps its columns and forgets its rows walks the critter off the
// bottom of the strait on the first press. Both halves are read: the tile, and
// the lives.
//
// The strait is emptied and the critter posed at the start column
// (`specs/strait.md`), so nothing but the hop itself can move it or reach it, and
// the drive runs on for a quarter of a second so that a life taken a tick late is
// still seen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOP_KEY, ROW_NEAR, START_COL, START_LIVES } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** How long the drive runs on after the refused press. */
const SETTLE_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("refuses a hop down from the near shore and costs no life", async () => {
  await startCrossing(harness);
  await harness.debug.addCritter(START_COL, ROW_NEAR);

  const after = await captureReplay(harness, "refuse", async () => {
    await harness.tap(HOP_KEY.down);
    await harness.advance(SETTLE_TICKS);
    return harness.snapshot();
  });

  assertEqual(after.critter.row, ROW_NEAR, "the near-shore row it stood on");
  assertEqual(after.critter.col, START_COL, "the column it stood on");
  assertEqual(after.critter.present, true, "the critter still on the strait");
  assertEqual(after.lives, START_LIVES, "the lives the run began with");
});
