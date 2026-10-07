// worm/oscillates-at-floor — a block on the floor row flips the worm upward.
//
// specs/worm.md, Winding: the turn a block produces checks the vertical heading
// first — "If the row at `r + dv` is off the board, which is a row outside `0`
// to `19`, the vertical heading flips first, so `dv` becomes `-dv`" — and only
// then moves the head one row on it. The spec draws the consequence out: "A
// worm on the floor row (`19`) heading down therefore flips to heading up and
// rises a row ... so a worm oscillates across the lower board rather than
// leaving it. A worm never leaves the board through an edge."
//
// THE WORLD THIS POSES. An empty, quiet board carrying one node and a worm of
// ONE segment on row `19`, descending. The node is what blocks the horizontal
// step; the floor is what flips the descent. It is posed at charge `1` —
// charged, left at `2` by the bump this block deals it, and clear of the
// `CHARGE_MAX` that would start a dive instead. A dive is impossible from row
// `19` in any case (specs/worm.md: a block by a critical node "when the head is
// already on row `18` or `19` turns the worm the ordinary way instead"), and
// posing the blocker short of critical keeps that from being the thing under
// test.
//
// The head is posed away from the cursor's own column, and the cursor's contact
// test is off, so nothing about the band decides this.

import { afterEach, beforeEach, it } from "vitest";
import { ROWS, WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormById,
  wormOn,
  type Harness,
  type WormSnapshot,
} from "../harness";

/** The floor row, and where the head is posed along it. */
const FLOOR_R = ROWS - 1;
const START_C = 6;
const BLOCKER_C = START_C + 1;

/** The blocker's charge: charged, and two bumps clear of critical. */
const BLOCKER_CHARGE = 1;

/**
 * How long a step may take before the drive gives up, in frames. Four of level
 * 1's `WORM_STEP_L1` (`0.14` s) intervals — a timeout, not a tolerance.
 */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips the vertical heading up and rises off the floor row", async () => {
  startPlaying(h);
  h.debug.setNode(BLOCKER_C, FLOOR_R, BLOCKER_CHARGE);
  const id = poseWorm(h, START_C, FLOOR_R, 1, 1, 1);

  let risen: WormSnapshot | undefined;
  let hit = false;

  // The recording carries the turn AND the step after it, so a reviewer sees
  // the worm travelling away from the floor rather than a single frozen move.
  await captureReplay(h, "floor", async () => {
    const swept = await h.until(
      (s) => wormOn(s, START_C, FLOOR_R) === undefined,
      { maxFrames: STEP_TIMEOUT, poll: 1 },
    );
    hit = swept.hit;
    risen = wormById(swept.snapshot, id);
    await h.until((s) => wormOn(s, START_C, FLOOR_R - 1) === undefined, {
      maxFrames: STEP_TIMEOUT,
      poll: 1,
    });
  });

  assertEqual(
    hit,
    true,
    `the head to leave (${START_C}, ${FLOOR_R}) within ${STEP_TIMEOUT} frames`,
  );
  assertDeepEqual(
    risen?.segments,
    [{ c: START_C, r: FLOOR_R - 1 }],
    "the head one row up, in its own column",
  );
  assertEqual(risen?.dv, -1, "dv, flipped to rising");
});
