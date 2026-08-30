// Wireworm — nodes/drop-leaves-charge: the drop half of a turn leaves the node it
// lands on exactly as it was.
//
// specs/nodes.md, "What raises a node's charge": "a worm dropping or diving into
// a tile a node stands on leaves that node's charge exactly as it was."
// specs/worm.md says the same from the worm's side: "Only a horizontal step can
// be blocked. The vertical move a block produces always takes the head into the
// tile at `(c, r + dv)`, whatever stands there," and "a node keeps the charge it
// had."
//
// The drop is produced by a SIDE-EDGE block rather than by a node, because a
// side-edge block charges nothing (specs/nodes.md), so the board carries exactly
// one node: the one the requirement is about. Nothing else on it can be confused
// for the reading.
//
// The node is posed at charge `2`, and that is the whole design of the point:
// `2` is the only value from which every wrong model reads as a different number.
// Left alone it reads `2`; charged as though the drop were a block it reads `3`;
// replaced by a fresh inert node it reads `0`; cleared or detonated it reads
// absent.
//
// That the head reaches the tile at all is `worm.drop-passes-through-node`'s
// requirement, so a build whose worm never turns at the edge is docked there and
// not twice here.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, wormStepInterval } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** Clear of the entry row and of the player band, so only the side edge blocks. */
const ROW = 8;

/** The last column on the board, so the step ahead of the head leaves it. */
const HEAD_C = COLS - 1;

/** The row the turn drops the head into, one below, in the head's own column. */
const LAND_R = ROW + 1;

/** Charged: the one value from which every wrong answer reads differently. */
const POSED = 2;

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

it("leaves the charge-2 node the worm dropped onto at charge 2", async () => {
  startPlaying(h);
  h.debug.setNode(HEAD_C, LAND_R, POSED);
  // Heading right off the last column, descending, so the block drops the head
  // one row down its own column.
  poseWorm(h, HEAD_C, ROW, 1, 1, 1);

  await h.advanceSeconds(ONE_STEP);
  captureStill(h, "landed");

  assertEqual(
    chargeAt(h.snapshot(), HEAD_C, LAND_R),
    POSED,
    `the charge on tile (${HEAD_C}, ${LAND_R}), which the head dropped onto`,
  );
});
