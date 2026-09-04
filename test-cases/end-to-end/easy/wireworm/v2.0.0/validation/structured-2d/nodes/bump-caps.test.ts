// Wireworm — nodes/bump-caps: a critical node stays critical when blocked again.
//
// specs/nodes.md, "What raises a node's charge": the rise is
// `charge = min(CHARGE_MAX, charge + 1)`, so `CHARGE_MAX` (`3`) is where it
// stops. A node already at critical is blocked into once more here, and the only
// thing this reads is the charge afterwards.
//
// Wrong models each read as their own number: a build with no cap reads `4`, one
// that wraps to inert reads `0`, and one that treats the block as a strike and
// detonates reads absent.
//
// The block happens above the player band, so specs/worm.md's dive rule is the
// one that governs the step — a block by a critical node from any row above
// `BAND_TOP_ROW` sends the worm diving. What the dive does to the WORM is
// `worm.dive-*`'s requirement; what it does to the node's charge is this one's,
// and the answer both rules give is that the charge is left alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  BAND_TOP_ROW,
  CHARGE_MAX,
  wormStepInterval,
} from "../../src/constants";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** Clear of the entry row, and above the player band, which the dive rule reads. */
const ROW = 8;

/** The head's column, and the column of the node directly ahead of it. */
const HEAD_C = 10;
const NODE_C = HEAD_C + 1;

/** Critical: the charge the cap holds at (specs/nodes.md). */
const POSED = CHARGE_MAX;

/**
 * Seconds run, so exactly one step happens and no second one does. At level 1
 * the interval is `WORM_STEP_L1` (`0.14` s, specs/worm.md); one and a half of it
 * is past the first step and short of the second.
 */
const ONE_STEP = wormStepInterval(1) * 1.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a critical node at critical when the worm is blocked by it", async () => {
  assertLessThan(ROW, BAND_TOP_ROW, "the block happens above the player band");

  startPlaying(h);
  h.debug.setNode(NODE_C, ROW, POSED);
  poseWorm(h, HEAD_C, ROW, 1);

  await h.advanceSeconds(ONE_STEP);
  captureStill(h, "capped");

  assertEqual(
    chargeAt(h.snapshot(), NODE_C, ROW),
    CHARGE_MAX,
    `the charge on tile (${NODE_C}, ${ROW}) after a block at the cap`,
  );
});
