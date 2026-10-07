// worm/oscillates-at-top — a block on the entry row flips a rising worm
// downward.
//
// specs/worm.md, Winding: the turn a block produces checks the vertical heading
// first — "If the row at `r + dv` is off the board, which is a row outside `0`
// to `19`, the vertical heading flips first, so `dv` becomes `-dv`" — and only
// then moves the head one row on it. The spec draws the consequence out: "a
// worm on the entry row (`0`) heading up flips to heading down and drops a
// row". This is the top half of the rule `worm.oscillates-at-floor` reads at
// the bottom.
//
// THE WORLD THIS POSES. An empty, quiet board carrying one node and a worm of
// ONE segment on row `0`, RISING — `dv` is posed at `-1`, which is the state
// this point is about and the reason it is a point of its own. The node is what
// blocks the horizontal step; the top of the board is what flips the ascent. It
// is posed at charge `1`: charged, left at `2` by the bump this block deals it,
// and clear of the `CHARGE_MAX` that would start a dive instead.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormById,
  wormOn,
  type Harness,
} from "../harness";

/** The entry row, and where the head is posed along it. */
const TOP_R = 0;
const START_C = 6;
const BLOCKER_C = START_C + 1;

/** The blocker's charge: charged, and two bumps clear of critical. */
const BLOCKER_CHARGE = 1;

/**
 * How long the step may take before the drive gives up, in frames. Four of
 * level 1's `WORM_STEP_L1` (`0.14` s) intervals — a timeout, not a tolerance.
 */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips the vertical heading down and drops off the entry row", async () => {
  startPlaying(h);
  h.debug.setNode(BLOCKER_C, TOP_R, BLOCKER_CHARGE);
  const id = poseWorm(h, START_C, TOP_R, 1, 1, -1);

  const swept = await h.until((s) => wormOn(s, START_C, TOP_R) === undefined, {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });

  captureStill(h, "top");

  assertEqual(
    swept.hit,
    true,
    `the head to leave (${START_C}, ${TOP_R}) within ${STEP_TIMEOUT} frames`,
  );
  assertDeepEqual(
    wormById(swept.snapshot, id)?.segments,
    [{ c: START_C, r: TOP_R + 1 }],
    "the head one row down, in its own column",
  );
  assertEqual(wormById(swept.snapshot, id)?.dv, 1, "dv, flipped to descending");
});
