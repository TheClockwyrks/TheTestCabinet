// hopping/refuse-right-edge — a hop off the right edge of the grid is refused.
//
// `specs/hopping.md` refuses a hop whose target tile "is outside the grid:
// `inBounds(col, row)` is false", and `specs/strait.md` fixes the grid at `COLS`
// (`40`) columns with "column `39` the rightmost". A hop right from column `39`
// therefore targets column `40` and is refused, and "a refused hop leaves
// everything as it was: the critter stays where it stands ... no life is lost".
//
// Both halves are read, because a build can refuse the MOVE and still charge for
// it. This is the RIGHT edge alone — `refuse-left-edge` decides the other one,
// and the two are separate items because the upper bound and the lower bound of
// `inBounds` are separate pieces of arithmetic a build can get wrong one at a
// time.
//
// The critter stands in the middle of an emptied ice band (`specs/strait.md`),
// where the footing is plain solid ice, and the drive runs on for a quarter of a
// second after the refused press so that a life taken a tick late is still seen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { COLS, HOP_KEY, START_LIVES } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The rightmost column, and a row of the ice band to stand it on. */
const COL = COLS - 1;
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

it("refuses a hop right from the last column and costs no life", async () => {
  await startCrossing(harness);
  await harness.debug.addCritter(COL, ROW);

  const after = await captureReplay(harness, "refuse", async () => {
    await harness.tap(HOP_KEY.right);
    await harness.advance(SETTLE_TICKS);
    return harness.snapshot();
  });

  assertEqual(after.critter.col, COL, "the column the critter stood on");
  assertEqual(after.critter.row, ROW, "the row the critter stood on");
  assertEqual(after.critter.present, true, "the critter still on the strait");
  assertEqual(after.lives, START_LIVES, "the lives the run began with");
});
