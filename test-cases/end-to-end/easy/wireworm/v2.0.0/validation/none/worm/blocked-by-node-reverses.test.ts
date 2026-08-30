// worm/blocked-by-node-reverses — blocked by a node, the worm ends the step with
// its horizontal heading reversed.
//
// specs/worm.md, "Winding": when a horizontal step is blocked, "the worm turns
// instead, all within the same step: 1. Its horizontal heading reverses, so `dh`
// becomes `-dh`."
//
// THE NODE IS AT CHARGE 1. A block by a node at charge `3` starts a DIVE instead
// (specs/worm.md, "Diving"), which is `worm.dive-enters`'s requirement, so the
// blocker here is charged short of critical.
//
// THE WORLD IS ONE NODE AND ONE HEAD. `startPlaying` leaves the board empty and
// the three world gates shut, and the scenario puts back the node the block is
// against and a one-segment worm one tile short of it, heading into it. The head
// is posed heading RIGHT, so the reversal reads as `dh` of `-1` and a build that
// left the heading alone reads `+1`.
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

/** The tile the blocking node stands on: a clear row, clear of every edge. */
const NODE_C = 12;
const NODE_R = 5;

/** The charge it is posed at: a node, and short of the critical charge. */
const NODE_CHARGE = 1;

/** The head, one tile short of the node and heading right into it. */
const HEAD_C = NODE_C - 1;
const HEAD_R = NODE_R;

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

it("reverses the horizontal heading on the step the node blocks", async () => {
  await startPlaying(h);
  await h.debug.setNode(NODE_C, NODE_R, NODE_CHARGE);
  const id = await poseWorm(h, { c: HEAD_C, r: HEAD_R, length: 1 });

  const swept = await h.until(
    (s) =>
      !segmentTiles(s).some((tile) => tile.c === HEAD_C && tile.r === HEAD_R),
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );
  await captureStill(h, "reversed");

  assertEqual(
    swept.hit,
    true,
    `the head to leave tile (${HEAD_C}, ${HEAD_R}) within ${STEP_TIMEOUT} frames`,
  );
  assertEqual(
    requireWorm(swept.snapshot, id, "the step the node blocked").dh,
    -1,
    "dh after the step the node blocked, posed at +1",
  );
});
