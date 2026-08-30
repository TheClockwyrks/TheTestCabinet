// Wireworm — nodes/segment-charges-nothing: a block by a worm segment charges nothing.
//
// specs/nodes.md, "What raises a node's charge": "A worm turned by the side edge
// of the board or by a worm segment changes no node's charge." Only a block BY A
// NODE energizes one.
//
// Two worms are posed: the one under test, one segment heading right, and a
// second worm of one segment standing on the tile its step would enter. That
// blocker is posed with BOTH FACULTIES OFF — no step and no body — because the
// requirement is about what a segment BLOCKS, not about what the blocker does:
// a blocker that steps away is not a blocker, and holding it still with its own
// gate is what the surface carries `setWormStepping` for.
//
// The field is a handful of nodes posed at charge `1`, so any wrong answer reads
// as a different number: a rise reads `2`, a fall reads `0`, a removal reads
// absent. The tiles are the ones a mis-scoped block could reach — the tile beyond
// the blocker in the direction of travel, which a build that looked through the
// segment for a node would charge, and two tiles beside the turn.
//
// Only the CHARGES are read, and the tile the turn takes the head into,
// `(HEAD_C, ROW + 1)`, is left EMPTY: what a turn leaves on the tile it lands in
// is `nodes.drop-leaves-charge`'s requirement, and this point must not decide it
// a second time.

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

/** Clear of the entry row and of the player band, so no edge rule is in play. */
const ROW = 8;

/** The head's column, and the column the blocking segment stands in. */
const HEAD_C = 10;
const BLOCK_C = HEAD_C + 1;

/** The charge every watched node is posed at, and must still hold. */
const POSED = 1;

/** The tiles the block is watched against. See the header for why each is here. */
const WATCHED = [
  { c: BLOCK_C + 1, r: ROW },
  { c: BLOCK_C, r: ROW + 1 },
  { c: HEAD_C - 1, r: ROW },
];

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

it("leaves every node's charge alone when another worm's segment turns the worm", async () => {
  startPlaying(h);
  for (const tile of WATCHED) h.debug.setNode(tile.c, tile.r, POSED);

  const blocker = poseWorm(h, BLOCK_C, ROW, 1);
  h.debug.setWormStepping(blocker, false);
  h.debug.setWormBody(blocker, false);

  poseWorm(h, HEAD_C, ROW, 1, 1, 1);

  await h.advanceSeconds(ONE_STEP);
  captureStill(h, "segment");

  const after = h.snapshot();
  for (const tile of WATCHED) {
    assertEqual(
      chargeAt(after, tile.c, tile.r),
      POSED,
      `the charge on tile (${tile.c}, ${tile.r})`,
    );
  }
});
