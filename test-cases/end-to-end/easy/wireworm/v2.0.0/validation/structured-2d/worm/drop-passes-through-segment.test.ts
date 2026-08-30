// worm/drop-passes-through-segment — the drop a block produces enters the tile
// below even when a worm segment stands on it.
//
// specs/worm.md, Winding: "Only a horizontal step can be blocked. The vertical
// move a block produces always takes the head into the tile at `(c, r + dv)`,
// whatever stands there. A node or a worm segment on that tile neither turns
// the worm nor is destroyed by it." This is the segment half of that rule;
// `worm.drop-passes-through-node` is the node half.
//
// THE WORLD THIS POSES. Two worms of ONE segment each: the worm under test, and
// a second standing on the tile directly below it with its `stepping` held off,
// which is exactly the faculty this scenario needs it not to have. The block
// itself comes from a node beside the head — the smallest thing that can start
// a turn — posed at charge `1`, so it is charged, is left at `2` by the bump
// this block deals it, and is nowhere near the `CHARGE_MAX` that would start a
// dive instead (`worm.dive-enters`).
//
// Only where the head ENDED is read. Two worms sharing a tile is the state the
// rule produces, and neither worm is destroyed by it.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormById,
  type Harness,
} from "../harness";

/** Where the head is posed, the tile that blocks it, and the tile below. */
const START_C = 10;
const START_R = 5;
const BLOCKER_C = START_C + 1;
const LANDING_R = START_R + 1;

/** The blocking node's charge: charged, and two bumps clear of critical. */
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

it("ends the drop on the tile a standing segment occupies", async () => {
  startPlaying(h);
  h.debug.setNode(BLOCKER_C, START_R, BLOCKER_CHARGE);

  // The occupant of the landing tile: one segment, standing still.
  const standing = poseWorm(h, START_C, LANDING_R, 1, 1, 1);
  h.debug.setWormStepping(standing, false);

  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  const swept = await h.until(
    (s) => {
      const head = wormById(s, id)?.segments[0];
      return head !== undefined && !(head.c === START_C && head.r === START_R);
    },
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );

  captureStill(h, "landed");

  assertEqual(
    swept.hit,
    true,
    `the head to leave (${START_C}, ${START_R}) within ${STEP_TIMEOUT} frames`,
  );
  assertDeepEqual(
    wormById(swept.snapshot, id)?.segments,
    [{ c: START_C, r: LANDING_R }],
    "the head on the tile the standing segment occupies",
  );
});
