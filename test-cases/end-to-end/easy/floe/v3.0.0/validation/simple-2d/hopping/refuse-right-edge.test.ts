// hopping/refuse-right-edge — a hop off the right edge of the grid is refused.
//
// specs/hopping.md refuses a hop whose target tile "is outside the grid:
// `inBounds(col, row)` is false", and specs/strait.md fixes the grid at `COLS`
// (`40`) columns with "column `39` the rightmost". A hop right from column `39`
// therefore targets column `40` and is refused, and "a refused hop leaves
// everything as it was: the critter stays where it stands ... no life is lost".
//
// BOTH HALVES ARE READ, because a build can refuse the MOVE and still charge for
// it. This is the RIGHT edge alone — `refuse-left-edge` decides the other one, and
// the two are separate items because the upper bound and the lower bound of
// `inBounds` are separate pieces of arithmetic a build can get wrong one at a
// time.
//
// THE WORLD IS THE REFUSAL AND NOTHING ELSE. `startCrossing` empties the strait
// and shuts the four world gates, and the critter is then posed in the middle of
// the ice band, which specs/strait.md makes solid ice the critter may stand on
// anywhere: nothing but the refused hop can move it, drown it or reach it. The
// drive runs on for a quarter of a second after the press so that a life taken a
// tick late is still seen.
//
// THE PRESS IS DOWN, ONE WHOLE TICK, UP. specs/controls.md reads the four movement
// actions as HELD on the `playing` screen, so a key genuinely down while a tick
// runs is the one press a held reading and a press-edge reading both see, and
// exactly once: `HOP_COOLDOWN` is `14.4` ticks, so no second request can follow
// inside that tick.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, START_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdFor,
  keyFor,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The rightmost column, and a row of the ice band to stand it on. */
const COL = COLS - 1;
const ROW = 15;

/** How long the drive runs on after the refused press, in ticks. */
const SETTLE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop right from the last column and costs no life", async () => {
  startCrossing(h);
  h.debug.addCritter(COL, ROW);

  const posed = h.snapshot().critter;
  assertEqual(
    posed.col,
    COL,
    "the pose put the critter on the rightmost column",
  );
  assertEqual(posed.row, ROW, "the pose put the critter on the ice band");

  const after = await captureReplay(h, "refuse", async () => {
    await holdFor(h, keyFor("right"), 1);
    await h.advance(SETTLE_TICKS);
    return h.snapshot();
  });

  assertEqual(
    after.critter.col,
    COL,
    "the column the critter stood on: a hop off the grid is refused (specs/hopping.md)",
  );
  assertEqual(after.critter.row, ROW, "the row the critter stood on");
  assertEqual(after.critter.present, true, "the critter still on the strait");
  assertEqual(
    after.lives,
    START_LIVES,
    "the lives the run began with: a refused hop costs none (specs/hopping.md)",
  );
});
