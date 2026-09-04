// worm/blocked-by-node-reverses — blocked by a node, the worm ends the step with
// its horizontal heading reversed.
//
// specs/worm.md, "Winding": when a horizontal step is blocked, "the worm turns
// instead, all within the same step: 1. Its horizontal heading reverses, so `dh`
// becomes `-dh`."
//
// BOTH DIRECTIONS ARE DRIVEN, and that is the point of the check rather than
// repetition. The rule is a REVERSAL, not an assignment: a build that answers
// every block with `dh = -1` is right about a worm heading right and wrong about
// one heading left, and only posing both tells the two apart. Each is posed on
// its own, one after the other, on a board cleared between them, so a failure
// names which heading the build got wrong. The `simple-2d` and `structured-2d`
// suites drive the same pair.
//
// THE NODE IS AT CHARGE 1. A block by a node at charge `3` starts a DIVE instead
// (specs/worm.md, "Diving"), which is `worm.dive-enters`'s requirement, so the
// blocker here is charged short of critical.
//
// THE WORLD IS ONE NODE AND ONE HEAD. `startPlaying` leaves the board empty and
// the three world gates shut, and each arrangement puts back the node the block
// is against and a one-segment worm one tile short of it, heading into it.
//
// WHAT THIS DOES NOT DECIDE. Where the head went is
// `worm.blocked-by-node-drops`'s requirement and the charge the block adds is
// `nodes.bump-charges`'s. This point reads `dh` alone.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWorm,
  requireWorm,
  segmentTiles,
  startPlaying,
  type Harness,
} from "../harness";

/** Where each head is posed: a clear row, clear of every edge. */
const START_C = 12;
const START_R = 5;

/** The blocker's charge: a node, and short of the critical charge. */
const NODE_CHARGE = 1;

/**
 * How long the step may take before the sweep gives up, in frames. Four of level
 * 1's `WORM_STEP_L1` (`0.14` s) intervals: a bound on a step that never happened,
 * not a tolerance on when it did.
 */
const STEP_TIMEOUT = framesFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/**
 * Pose a one-segment worm heading `dh` into a node on that side, take its one
 * step, and answer the horizontal heading the step left behind.
 */
async function blockedHeading(dh: number): Promise<number> {
  await h.debug.clearWorms();
  await h.debug.clearNodes();
  await h.debug.setNode(START_C + dh, START_R, NODE_CHARGE);
  const id = await poseWorm(h, { c: START_C, r: START_R, length: 1, dh });

  const swept = await h.until(
    (s) =>
      !segmentTiles(s).some((tile) => tile.c === START_C && tile.r === START_R),
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );
  assertEqual(
    swept.hit,
    true,
    `heading ${dh}: the head to leave tile (${START_C}, ${START_R}) within ` +
      `${STEP_TIMEOUT} frames`,
  );
  return requireWorm(swept.snapshot, id, "the step the node blocked").dh;
}

it("reverses the horizontal heading on the step the node blocks", async () => {
  await startPlaying(h);

  const turnedFromRight = await blockedHeading(1);
  await captureStill(h, "reversed");
  assertEqual(turnedFromRight, -1, "a worm heading right, blocked: dh");

  const turnedFromLeft = await blockedHeading(-1);
  assertEqual(turnedFromLeft, 1, "a worm heading left, blocked: dh");
});
