// Wireworm — nodes/bump-charges: a block by an inert node energizes it.
//
// specs/nodes.md, "What raises a node's charge": a node gains one charge when
// the worm's head is blocked by it, `charge = min(CHARGE_MAX, charge + 1)`, and
// "the rise happens on the step the block happens". This poses the one node the
// requirement concerns directly ahead of a one-segment worm on an otherwise
// empty board, lets the build's own step clock run exactly one step, and reads
// the charge back.
//
// The node is posed INERT, which is the state this point is about, and every
// wrong model reads as a different number from it: a build that charges nothing
// reads 0, one that charges twice reads 2, one that caps low reads 0, and one
// that destroys what blocks it reads absent.
//
// A one-segment worm is the whole entity the requirement exercises. It carries
// no body to follow, so nothing but the head's own step can reach the field.

import { afterEach, beforeEach, it } from "vitest";
import { wormStepInterval } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * The row the block happens on: clear of the entry row (`0`) the worm arrives
 * along and of the player band (`18`, `19`), so nothing about the board's edges
 * is in play.
 */
const ROW = 8;

/** The head's column, and the column of the node directly ahead of it. */
const HEAD_C = 10;
const NODE_C = HEAD_C + 1;

/** The charge the node is posed at: inert, which is what this point starts from. */
const POSED = 0;

/** The charge one block owes it, `min(CHARGE_MAX, 0 + 1)` (specs/nodes.md). */
const BUMPED = 1;

/**
 * Seconds run, so exactly one step happens and no second one does.
 *
 * A worm steps each time its own clock reaches the level's interval
 * (specs/worm.md), which at level 1 is `WORM_STEP_L1` (`0.14` s). One and a half
 * intervals is past the first step and short of the second, whichever frame
 * boundary the clock lands on.
 */
const ONE_STEP = wormStepInterval(1) * 1.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the node that blocked the worm from inert to charge 1", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, ROW, POSED);
  poseWorm(h, HEAD_C, ROW, 1);

  await h.advanceSeconds(ONE_STEP);
  captureStill(h, "bumped");

  assertEqual(
    chargeAt(h.snapshot(), NODE_C, ROW),
    BUMPED,
    `the charge on tile (${NODE_C}, ${ROW}) after one block`,
  );
});
