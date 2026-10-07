// nodes/drop-leaves-charge — a drop leaves the node it lands on exactly as it was.
//
// specs/nodes.md: "a worm dropping or diving into a tile a node stands on leaves
// that node's charge exactly as it was." specs/worm.md states the same rule from
// the worm's side: "The vertical move a block produces always takes the head into
// the tile at `(c, r + dv)`, whatever stands there. A node or a worm segment on
// that tile neither turns the worm nor is destroyed by it, and a node keeps the
// charge it had."
//
// TWO NODES, AND ONLY ONE OF THEM IS READ. A drop only happens off a block, so the
// scenario needs something to block against: an INERT node one tile along the
// head's heading. That node is the block, and what the block does to it is
// `nodes.bump-charges`'s requirement, so it is not read here. What is read is the
// node the head lands ON, one row below the head in its own column.
//
// THE LANDING NODE IS POSED AT CHARGE 2, and that is the whole point of the
// arrangement: `2` is the only charge from which "left alone" (2), "bumped" (3),
// "replaced by a fresh inert node" (0) and "cleared or detonated" (absent) all
// read back as different answers, so a failure names which wrong model the build
// implemented. Posed at `0` a bump and a fresh node would be indistinguishable;
// posed at `3` a bump and being left alone would be.
//
// THE BLOCKER IS INERT, NOT CRITICAL, so specs/worm.md gives an ordinary turn
// rather than a dive: what the dive passes through is `nodes.dive-leaves-charge`'s
// requirement, and this point is about the single row the turn drops through.
//
// WHAT THIS DOES NOT DECIDE. That the head ends the step on the landing tile is
// `worm.drop-passes-through-node`'s requirement. This point reads the charge
// alone, so a build that stops short of the tile is docked there and not twice.

import { afterEach, beforeEach, it } from "vitest";
import { wormStepInterval } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The worm's head, clear of every edge and well above the player band. */
const WORM_C = 11;
const WORM_R = 5;

/** The inert node the head is blocked by, one tile along its heading. */
const BLOCK_C = WORM_C + 1;

/**
 * The node the head drops onto, one row down in its own column, and the charge it
 * is posed and read at.
 */
const LANDING_R = WORM_R + 1;
const LANDING_CHARGE = 2;

/**
 * Frames covering exactly one worm step at level 1.
 *
 * specs/worm.md clocks the worm on `wormStepInterval(level)`, which is `0.14` s
 * at level 1. Rounded up to whole frames of the 120 Hz clock that is 17 frames
 * (`0.1417` s): past one interval, and well short of the `0.28` s a second step
 * would need, so exactly one block and one drop happen inside the drive.
 */
const ONE_STEP_TICKS = ticksFor(wormStepInterval(1));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the charge-2 node the worm dropped onto at charge 2", async () => {
  startPlaying(h);
  h.debug.setNode(BLOCK_C, WORM_R, 0);
  h.debug.setNode(WORM_C, LANDING_R, LANDING_CHARGE);
  poseWorm(h, WORM_C, WORM_R, 1, 1, 1);

  await h.advance(ONE_STEP_TICKS);
  captureStill(h, "landed");

  assertEqual(
    chargeAt(h.snapshot(), WORM_C, LANDING_R),
    LANDING_CHARGE,
    `the charge on the node at (${WORM_C}, ${LANDING_R}) the drop landed on`,
  );
});
