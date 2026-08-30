// nodes/bump-caps — a critical node blocked again is still critical.
//
// specs/nodes.md: "A node gains one charge when the worm's head is blocked by it,
// capped at `CHARGE_MAX`: `charge = min(CHARGE_MAX, charge + 1)`", and charge is
// "a whole number from `0` to `CHARGE_MAX` (`3`)".
//
// THE CAP IS THE EDGE CASE, so it is its own point: a build that adds one without
// the `min` reads 4 here, a build that wraps to `0` reads 0, and a build that
// treats a fourth block as a strike leaves the tile empty. All three read
// differently from the 3 the rule fixes, so the failure names the model the build
// implemented.
//
// THE BLOCK IS AGAINST A CRITICAL NODE, so specs/worm.md has the worm DIVE rather
// than turn. That is the same block either way — the node is what stopped the head
// — and this point reads the node alone. Whether the dive is entered is
// `worm.dive-enters`'s requirement, and what the dive does to the nodes it passes
// through is `nodes.dive-leaves-charge`'s.
//
// THE HEAD IS ABOVE THE BAND AND THE COLUMN BELOW IT IS EMPTY, so nothing the dive
// enters in the one step this drive covers is a node, and the only node on the
// board is the one under test.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, wormStepInterval } from "../../src/constants";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a critical node at the cap when the worm is blocked by it again", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, CHARGE_MAX);
  poseWorm(h, NODE_C - 1, NODE_R, 1, 1, 1);

  await h.advance(ONE_STEP_TICKS);
  captureStill(h, "capped");

  assertEqual(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    CHARGE_MAX,
    `the charge on the node at (${NODE_C}, ${NODE_R}) after a block at the cap`,
  );
});
