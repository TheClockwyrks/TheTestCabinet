// Wireworm — nodes/bump-climbs: successive blocks climb a node to critical.
//
// specs/nodes.md, "What raises a node's charge": the rise is one level per
// block, `charge = min(CHARGE_MAX, charge + 1)`, "once per block rather than
// continuously while the worm touches the node". A node that starts inert is
// therefore at `1`, `2` and `3` after the first, second and third block, and
// this reads all three in turn — the requirement is the CLIMB, so a build that
// charges the first block and then stops has to fail somewhere the reading
// names.
//
// The worm is posed afresh for each block rather than steered back around,
// because the block is what the requirement is about and the route back to it is
// not. `clearWorms` empties the worm roster alone (specs/instrumentation.md), so
// the node keeps the charge the previous block left it at.
//
// The third block leaves the node critical but is not itself a block BY a
// critical node: at the moment of that block the node stands at `2`, so the
// ordinary rule applies. What a block by an already-critical node does is
// `nodes.bump-caps`'s requirement.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, wormStepInterval } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** Clear of the entry row and of the player band, so no edge rule is in play. */
const ROW = 8;

/** The head's column, and the column of the node directly ahead of it. */
const HEAD_C = 10;
const NODE_C = HEAD_C + 1;

/** The charge the node is posed at, before the first block. */
const POSED = 0;

/** The ladder one block at a time owes, from `POSED` up to `CHARGE_MAX` (`3`). */
const CLIMB = [1, 2, 3];

/**
 * Seconds run per block, so exactly one step happens each time.
 *
 * At level 1 the interval is `WORM_STEP_L1` (`0.14` s, specs/worm.md), and one
 * and a half of it is past the first step and short of the second. Each worm's
 * clock starts at zero when the worm comes into existence, so a freshly posed
 * worm takes its first step against the same measure.
 */
const ONE_STEP = wormStepInterval(1) * 1.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("climbs the node one charge per block, from inert to critical", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, ROW, POSED);

  for (const expected of CLIMB) {
    h.debug.clearWorms();
    poseWorm(h, HEAD_C, ROW, 1);

    await h.advanceSeconds(ONE_STEP);
    // Rewritten each time round, so the still kept is the last block that ran:
    // the third on a build that climbs, and the failing one on a build that does
    // not.
    captureStill(h, "critical");

    assertEqual(
      chargeAt(h.snapshot(), NODE_C, ROW),
      expected,
      `the charge on tile (${NODE_C}, ${ROW}) after block ${expected}`,
    );
  }

  assertEqual(
    chargeAt(h.snapshot(), NODE_C, ROW),
    CHARGE_MAX,
    `the charge on tile (${NODE_C}, ${ROW}) after the climb`,
  );
});
