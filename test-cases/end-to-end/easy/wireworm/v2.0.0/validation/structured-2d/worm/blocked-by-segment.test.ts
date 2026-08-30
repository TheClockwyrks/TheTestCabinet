// worm/blocked-by-segment — a worm segment blocks and turns the worm.
//
// specs/worm.md, Winding: a horizontal step is blocked when the target tile is
// "a tile holding a worm segment, of this worm or of any other", and the turn a
// block produces reverses `dh` and moves the head one row in `dv`.
//
// THE WORLD THIS POSES. Two worms of ONE segment each on an empty, quiet board:
// the worm under test, and a second one standing on the tile it is heading
// into. The second worm's `stepping` is held off, which is exactly the faculty
// this scenario needs it not to have — it is a tile the step has to run into,
// and nothing else. Its body gate is irrelevant to a worm of one segment, and
// neither worm has a body to follow, so the only rule that can move the head
// under test is the block.
//
// NO NODE IS POSED ANYWHERE. specs/nodes.md is explicit that "a worm turned by
// the side edge of the board or by a worm segment changes no node's charge", so
// a node on the board could only blur which rule a failure came from.

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
  wormOn,
  type Harness,
} from "../harness";

/** Where the head under test is posed, and the tile the blocker stands on. */
const START_C = 10;
const START_R = 5;
const BLOCKER_C = START_C + 1;

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

it("drops and reverses a worm whose next tile holds a segment", async () => {
  startPlaying(h);

  // The blocker: one segment, standing still, on the tile ahead.
  const blocker = poseWorm(h, BLOCKER_C, START_R, 1, 1, 1);
  h.debug.setWormStepping(blocker, false);

  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  const swept = await h.until((s) => wormOn(s, START_C, START_R)?.id !== id, {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });

  captureStill(h, "segment");

  assertEqual(
    swept.hit,
    true,
    `the head to leave (${START_C}, ${START_R}) within ${STEP_TIMEOUT} frames`,
  );
  assertDeepEqual(
    wormById(swept.snapshot, id)?.segments,
    [{ c: START_C, r: START_R + 1 }],
    "the head one row on, in its own column",
  );
  assertEqual(wormById(swept.snapshot, id)?.dh, -1, "dh");
});
