// hopping/refuse-vehicle — a tile a vehicle covers refuses a hop, and costs
// nothing.
//
// specs/hopping.md (Refused hops): a hop is refused when its target tile "is
// covered by a vehicle", and "a refused hop leaves everything as it was ... no
// life is lost". specs/ice.md fixes the covering rule — an item "occupies
// `[x, x + TILE * len)` on its own row" and covers a tile when "that tile's
// center is covered" — and states the consequence directly: "Every tile a
// vehicle covers is closed to the critter: a hop onto it is refused."
//
// A plow is parked with its left edge on the column left of the target, so its
// three tiles cover the target tile's centre squarely rather than at an edge:
// what is under test is the refusal, not where a span begins and ends. Its lane
// is held at a speed of `0`, which is what makes the reading about the hop
// alone — specs/ice.md crushes the critter only under a lane whose speed is
// above `0`, so a parked vehicle takes no life, and a build that refuses the hop
// correctly cannot then be graded on a crush it never caused.
//
// The critter is posed on the ice row below, which `startCrossing` leaves empty,
// and the reading is taken again a settling window later: a refused hop costs no
// life, and a build that moves the critter under the plow and crushes it there
// is exactly what that second reading catches.

import { afterEach, beforeEach, it } from "vitest";
import { ICE_TOP, START_COL, START_LIVES } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The row the plow is parked on, and the ice row the critter hops from. */
const VEHICLE_ROW = ICE_TOP;
const CRITTER_ROW = ICE_TOP + 1;

/** The column hopped into, and the plow's left edge one column left of it. */
const COL = START_COL;
const PLOW_COL = COL - 1;

/** Frames watched after the refused press: half a second of game time. */
const SETTLE_FRAMES = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop onto a tile a parked vehicle covers and costs no life", async () => {
  startCrossing(h);
  poseLane(h, VEHICLE_ROW, "plow", [PLOW_COL]);
  h.debug.setCritterTile(COL, CRITTER_ROW);

  const after = await captureReplay(h, "refuse", async () => {
    await hop(h, "up");
    await h.advance(SETTLE_FRAMES);
    return h.snapshot();
  });

  assertEqual(
    after.critter.row,
    CRITTER_ROW,
    "the row after a hop into a parked plow",
  );
  assertEqual(
    after.critter.col,
    COL,
    "the column after a hop into a parked plow",
  );
  assertEqual(after.lives, START_LIVES, "lives after a hop into a parked plow");
  assertEqual(
    after.phase,
    "crossing",
    "the phase after a hop into a parked plow",
  );
  assertTrue(
    after.critter.present,
    "the critter still in play after a refused hop",
  );
});
