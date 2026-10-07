// worm/blocked-by-node-drops — blocked by a node, the head ends the step one row
// on in its vertical heading, in its own column.
//
// specs/worm.md, "Winding": a horizontal step is blocked when the target tile is
// "a tile holding a node", and when it is blocked "the head moves one row in its
// vertical heading, to `(c, r + dv)`, staying in its own column".
//
// THE NODE IS AT CHARGE 1. A block by a node at charge `3` starts a DIVE instead
// (specs/worm.md, "Diving"), which is `worm.dive-enters`'s requirement, so the
// blocker here is charged short of critical. `1` rather than `0` because the spec
// blocks on "a tile holding a node" whatever its charge, and a build that blocks
// only on inert nodes has to fail somewhere.
//
// THE WORLD IS ONE NODE AND ONE HEAD. `startPlaying` leaves the board empty and
// the three world gates shut, and the scenario puts back the node the block is
// against and a one-segment worm one tile short of it, heading into it. A
// one-segment worm has no body to follow, so the head's tile after the step is the
// only thing that moved, and both edges and every other entity are far away.
//
// WHAT THIS DOES NOT DECIDE. That the block reverses the horizontal heading is
// `worm.blocked-by-node-reverses`'s requirement and the charge the block adds is
// `nodes.bump-charges`'s, so neither is read here: this point reads the head's
// tile alone, and a build that mishandles either of those is docked there.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  headOf,
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

/** The head, one tile short of the node and heading into it. */
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

it("drops the head one row in its vertical heading, in its own column", async () => {
  await startPlaying(h);
  await h.debug.setNode(NODE_C, NODE_R, NODE_CHARGE);
  const id = await poseWorm(h, { c: HEAD_C, r: HEAD_R, length: 1 });

  const swept = await h.until(
    (s) =>
      !segmentTiles(s).some((tile) => tile.c === HEAD_C && tile.r === HEAD_R),
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );
  await captureStill(h, "dropped");

  assertEqual(
    swept.hit,
    true,
    `the head to leave tile (${HEAD_C}, ${HEAD_R}) within ${STEP_TIMEOUT} frames`,
  );
  // A build that walked through the node reads (12, 5); one that dropped without
  // holding its column reads some other column; one that rose reads row 4.
  assertDeepEqual(
    headOf(requireWorm(swept.snapshot, id, "the step the node blocked")),
    { c: HEAD_C, r: HEAD_R + 1 },
    "the head one row on in its vertical heading, in its own column",
  );
});
