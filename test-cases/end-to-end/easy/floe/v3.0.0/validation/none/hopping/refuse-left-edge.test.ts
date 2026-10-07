// hopping/refuse-left-edge — a hop off the left edge of the grid is refused.
//
// `specs/hopping.md` refuses a hop whose target tile "is outside the grid:
// `inBounds(col, row)` is false", and `specs/strait.md` fixes the grid at `COLS`
// (`40`) columns with "column `0` the leftmost". A hop left from column `0`
// therefore targets column `-1` and is refused, and "a refused hop leaves
// everything as it was: the critter stays where it stands ... no life is lost".
//
// Both halves are read, because a build can refuse the MOVE and still charge for
// it: the critter is still on column `0` of the row it stood on, and the run
// still holds every life it had. This is the LEFT edge alone —
// `refuse-right-edge` decides the other one, so a build that clamps one and not
// the other is graded on the one it got wrong.
//
// The critter stands in the middle of an emptied ice band (`specs/strait.md`),
// where the footing is plain solid ice, and the drive runs on for a quarter of a
// second after the refused press so that a life taken a tick late is still seen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOP_KEY, START_LIVES } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The leftmost column, and a row of the ice band to stand it on. */
const COL = 0;
const ROW = 15;

/** How long the drive runs on after the refused press. */
const SETTLE_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("refuses a hop left from column 0 and costs no life", async () => {
  await startCrossing(harness);
  await harness.debug.addCritter(COL, ROW);

  const after = await captureReplay(harness, "refuse", async () => {
    await harness.tap(HOP_KEY.left);
    await harness.advance(SETTLE_TICKS);
    return harness.snapshot();
  });

  assertEqual(after.critter.col, COL, "the column the critter stood on");
  assertEqual(after.critter.row, ROW, "the row the critter stood on");
  assertEqual(after.critter.present, true, "the critter still on the strait");
  assertEqual(after.lives, START_LIVES, "the lives the run began with");
});
