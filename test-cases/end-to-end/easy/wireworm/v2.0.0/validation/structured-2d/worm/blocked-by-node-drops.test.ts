// worm/blocked-by-node-drops — blocked by a node, the head ends the step one
// row on in its vertical heading, in its own column.
//
// specs/worm.md, Winding: a horizontal step into "a tile holding a node" is
// blocked, and the turn a block produces moves "the head one row in its
// vertical heading, to `(c, r + dv)`, staying in its own column". This point
// reads that landing tile and nothing else: the heading the same block reverses
// is `worm.blocked-by-node-reverses`' requirement, and the charge the same
// block deals the node is `nodes.bump-charges`'.
//
// THE WORLD THIS POSES. An empty, quiet board carrying one node and a worm of
// ONE segment beside it. There is no body to follow, no second worm, and no
// other node, so the only rule that can move the head is the block.
//
// THE BLOCKER'S CHARGE IS DELIBERATELY NOT `CHARGE_MAX`. A block by a critical
// node starts a DIVE instead of a turn (`worm.dive-enters`), which lands the
// head on the very same tile; posing the blocker at `1` — charged, and left at
// `2` by the bump this block deals it, still short of critical — keeps this
// check on the turn it names.
//
// The landing tile is left empty, and the head is posed on row 5 with `dv` down,
// so `r + dv` is on the board and no vertical flip is in play
// (`worm.oscillates-at-floor` is that rule).

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

/** Where the head is posed, and the tile whose node blocks it. */
const START_C = 10;
const START_R = 5;
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

it("drops the head one row into its own column when a node blocks it", async () => {
  startPlaying(h);
  h.debug.setNode(BLOCKER_C, START_R, BLOCKER_CHARGE);
  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  const swept = await h.until(
    (s) => wormOn(s, START_C, START_R) === undefined,
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );

  captureStill(h, "dropped");

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
});
