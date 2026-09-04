// nodes/bump-climbs — successive blocks raise one node 0 -> 1 -> 2 -> 3.
//
// specs/nodes.md: "A node gains one charge when the worm's head is blocked by it,
// capped at `CHARGE_MAX` (`3`) ... The rise happens on the step the block happens,
// once per block rather than continuously while the worm touches the node."
//
// ONE STEP PER BLOCK IS WHAT IS READ, so the point reads the charge after each of
// the three blocks rather than only after the last. A build that climbs two levels
// per block reaches 3 early and reads 2 after the first pass; a build that latches
// at 1 reads 1 after all three; a build that only ever charges a node it has not
// charged before reads 1 as well, but at a different pass, and the failure names
// which.
//
// A BLOCKED WORM LEAVES. specs/worm.md turns the worm on the step it is blocked —
// its horizontal heading reverses and its head drops a row — so the same head
// never faces the same node twice, and there is no arrangement of one worm that
// blocks against one node three times without walking it back across half the
// board through rules this point is not about. Each pass therefore poses the head
// afresh: `clearWorms` empties the roster and one worm goes back one tile short of
// the node, heading into it. The board between passes is the same empty, quiet
// board `startPlaying` poses and every check in this suite stands on, and no frame
// runs while the roster is empty.
//
// WHAT THIS DOES NOT DECIDE. That the FIRST block energizes an inert node is
// `nodes.bump-charges`'s requirement, and that the fourth leaves a critical node
// at 3 is `nodes.bump-caps`'s. This point is the climb between them.

import { afterEach, beforeEach, it } from "vitest";
import { wormStepInterval } from "../../src/constants";
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
 * would need, so each pass runs exactly one block.
 */
const ONE_STEP_TICKS = ticksFor(wormStepInterval(1));

/**
 * The charge the node holds after each block, in order.
 *
 * `min(CHARGE_MAX, charge + 1)` applied three times from `0`, straight off the
 * formula specs/nodes.md states. Whole numbers throughout, so the readings need no
 * tolerance.
 */
const CLIMB = [1, 2, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("climbs the node one charge per block, to critical", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, 0);

  for (const [pass, expected] of CLIMB.entries()) {
    // The worm from the previous block has turned away and is no longer facing
    // the node; a fresh head one tile short of it is the next block.
    h.debug.clearWorms();
    poseWorm(h, NODE_C - 1, NODE_R, 1, 1, 1);

    await h.advance(ONE_STEP_TICKS);
    if (pass === CLIMB.length - 1) captureStill(h, "critical");

    assertEqual(
      chargeAt(h.snapshot(), NODE_C, NODE_R),
      expected,
      `the charge on the node at (${NODE_C}, ${NODE_R}) after block ${pass + 1}`,
    );
  }
});
