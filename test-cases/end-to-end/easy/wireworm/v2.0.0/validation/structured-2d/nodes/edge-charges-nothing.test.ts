// Wireworm — nodes/edge-charges-nothing: a block by the side edge charges nothing.
//
// specs/nodes.md, "What raises a node's charge": "A worm turned by the side edge
// of the board or by a worm segment changes no node's charge." Only a block BY A
// NODE energizes one, and the side edge is not a node.
//
// The worm is posed on the last column heading outward, so the tile its step
// would enter is off the board and the block is the edge's alone. The board
// carries a small field of charged nodes, every one of them posed at charge `1`,
// so any wrong answer reads as a different number: a rise reads `2`, a fall reads
// `0`, and a removal reads absent.
//
// The tiles are the ones a mis-scoped block could plausibly reach — the two in
// column `0`, which is where the off-board target `(COLS, ROW)` lands under
// row-major index arithmetic that never tests the column bound, and the two
// behind the head. The tile the turn takes the head into, `(HEAD_C, ROW + 1)`, is
// left EMPTY on purpose: what a drop does to the node it lands on is
// `nodes.drop-leaves-charge`'s requirement, and this point must not decide it a
// second time.
//
// Only the CHARGES are read. What a turn leaves on the tile it lands in — a
// standing node's charge, or a fresh node where the tile was empty — is
// `nodes.drop-leaves-charge`'s requirement, and this point must not decide it a
// second time. A node the block removed still fails here, because a removed node
// reads absent rather than at its posed charge.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, wormStepInterval } from "../constants";
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

/** The charge every watched node is posed at, and must still hold. */
const POSED = 1;

/** The tiles the block is watched against. See the header for why each is here. */
const WATCHED = [
  { c: 0, r: ROW },
  { c: 0, r: ROW + 1 },
  { c: HEAD_C - 1, r: ROW },
  { c: HEAD_C - 1, r: ROW + 1 },
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

it("leaves every node's charge alone when the side edge turns the worm", async () => {
  startPlaying(h);
  for (const tile of WATCHED) h.debug.setNode(tile.c, tile.r, POSED);
  // Heading right off the last column, so the tile ahead is off the board.
  poseWorm(h, HEAD_C, ROW, 1, 1, 1);

  await h.advanceSeconds(ONE_STEP);
  captureStill(h, "edge");

  const after = h.snapshot();
  for (const tile of WATCHED) {
    assertEqual(
      chargeAt(after, tile.c, tile.r),
      POSED,
      `the charge on tile (${tile.c}, ${tile.r})`,
    );
  }
});
