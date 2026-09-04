// worm/blocked-by-node-reverses — blocked by a node, the horizontal heading
// reverses.
//
// specs/worm.md, Winding: when the step is blocked "the worm turns instead, all
// within the same step: its horizontal heading reverses, so `dh` becomes
// `-dh`". This point reads that heading and nothing else — the row the same
// block drops the head to is `worm.blocked-by-node-drops`' requirement, and the
// charge it deals the node is `nodes.bump-charges`'.
//
// BOTH DIRECTIONS ARE DRIVEN, and that is the point of the check rather than
// repetition. The rule is a REVERSAL, not an assignment: a build that answers
// every block with `dh = -1` is right about a worm heading right and wrong
// about one heading left, and only posing both tells the two apart. Each is
// posed on its own, one after the other, on a board cleared between them, so a
// failure names which heading the build got wrong.
//
// The blocker is posed at charge `1` in both arrangements — charged, and left
// at `2` by the bump this block deals it. A block by a node at `CHARGE_MAX`
// starts a dive rather than a turn (`worm.dive-enters`) and would reverse
// nothing.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertEqual } from "../assert";
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

/** Where each head is posed, on a clear row well inside both side edges. */
const START_C = 10;
const START_R = 5;

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

/**
 * Pose a one-segment worm heading `dh` into a node on that side, take its one
 * step, and answer the horizontal heading the step left behind.
 */
async function blockedHeading(dh: number): Promise<number | undefined> {
  h.debug.clearWorms();
  h.debug.clearNodes();
  h.debug.setNode(START_C + dh, START_R, BLOCKER_CHARGE);
  const id = poseWorm(h, START_C, START_R, 1, dh, 1);

  const swept = await h.until(
    (s) => wormOn(s, START_C, START_R) === undefined,
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );
  assertEqual(
    swept.hit,
    true,
    `heading ${dh}: the head to leave (${START_C}, ${START_R}) within ${STEP_TIMEOUT} frames`,
  );
  return wormById(swept.snapshot, id)?.dh;
}

it("reverses the horizontal heading a node blocked", async () => {
  startPlaying(h);

  const turnedFromRight = await blockedHeading(1);
  captureStill(h, "reversed");
  assertEqual(turnedFromRight, -1, "a worm heading right, blocked: dh");

  const turnedFromLeft = await blockedHeading(-1);
  assertEqual(turnedFromLeft, 1, "a worm heading left, blocked: dh");
});
