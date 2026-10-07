// nodes/bump-charges — a worm blocked by an inert node energizes it to charge 1.
//
// specs/nodes.md: "A node gains one charge when the worm's head is blocked by it,
// capped at `CHARGE_MAX` ... The rise happens on the step the block happens, once
// per block rather than continuously while the worm touches the node."
//
// THE WORLD IS ONE NODE AND ONE HEAD. `startPlaying` leaves the board empty and
// the three world gates shut, and the scenario puts back exactly the two things
// the rule names: the node the block is against, and a one-segment worm one tile
// short of it, heading into it. A one-segment worm has no body to follow, so the
// only faculty running is the step — which is the faculty this rule belongs to.
//
// THE SPAN IS ONE STEP. The worm is clocked (specs/worm.md), so the drive covers
// exactly one interval: the rise is asserted on the step the block happened, and a
// build that charged the node once per frame while the head touched it cannot pass
// by having climbed to 1 on the way to somewhere else.
//
// WHAT THIS DOES NOT DECIDE. That the block turns the worm at all is
// `worm.blocked-by-node-reverses`'s requirement and that it drops a row is
// `worm.blocked-by-node-drops`'s, so neither is read here: this point reads the
// node's charge alone, and a build that mishandles the turn is docked there.

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

/** The tile the node stands on, well clear of every edge and of the band. */
const NODE_C = 12;
const NODE_R = 5;

/**
 * Frames covering exactly one worm step at level 1.
 *
 * specs/worm.md clocks the worm on `wormStepInterval(level)`, which is `0.14` s
 * at level 1. Rounded up to whole frames of the 120 Hz clock that is 17 frames
 * (`0.1417` s): past one interval, and well short of the `0.28` s a second step
 * would need, so exactly one block happens inside the drive.
 */
const ONE_STEP_TICKS = ticksFor(wormStepInterval(1));

/**
 * The charge one block leaves on a node that was inert.
 *
 * `min(CHARGE_MAX, 0 + 1)`, straight off the formula specs/nodes.md states. Whole
 * numbers throughout, so the reading needs no tolerance: charge is "a whole number
 * from `0` to `CHARGE_MAX`".
 */
const AFTER_ONE_BUMP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises an inert node to charge 1 on the step it blocks the worm", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, 0);
  poseWorm(h, NODE_C - 1, NODE_R, 1, 1, 1);

  await h.advance(ONE_STEP_TICKS);
  captureStill(h, "bumped");

  // The posed value is 0, so every wrong model reads as its own number: 0 is a
  // build that charges nothing, 2 a build that charges twice, and an absent node
  // a build that treats the block as a strike.
  assertEqual(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    AFTER_ONE_BUMP,
    `the charge on the node at (${NODE_C}, ${NODE_R}) after one block`,
  );
});
