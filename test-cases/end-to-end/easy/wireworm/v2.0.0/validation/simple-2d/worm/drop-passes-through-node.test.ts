// worm/drop-passes-through-node — the drop a block produces enters the tile below
// whatever stands there, a node included.
//
// specs/worm.md, "Winding": "Only a horizontal step can be blocked. The vertical
// move a block produces always takes the head into the tile at `(c, r + dv)`,
// whatever stands there. A node or a worm segment on that tile neither turns the
// worm nor is destroyed by it, and a node keeps the charge it had."
//
// THE LANDING NODE IS POSED AT CHARGE 2, AND THAT VALUE IS LOAD-BEARING. `2` is
// the one charge from which every wrong model reads as a different number: a build
// that let the node block the drop leaves the head on row `5`, a build that ate
// the node leaves the tile empty, a build that laid a fresh node over it reads `0`,
// and a build that detonated it clears a neighbourhood. This point reads the head;
// what the node's charge is afterwards is `nodes.drop-leaves-charge`'s requirement.
//
// THE BLOCK IS THE BOARD'S EDGE, AND THAT IS DELIBERATE. A drop needs a block, and
// the three things that block a step are the edge, a node, and a segment — of
// which only the edge adds NOTHING to the world. So the board holds exactly one
// thing: the node the drop lands on. The edge rule itself is graded by
// `worm.blocked-by-edge`.
//
// The head is on row `5`, so `r + dv` is row `6` — a real row, far above the
// floor, and the vertical heading has no reason to flip. That is
// `worm.oscillates-at-floor`'s requirement.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseWorm,
  segmentAt,
  startPlaying,
  ticksFor,
  wormOf,
  type Harness,
} from "../harness";

/** The head, on the last column and heading outward, so the edge blocks it. */
const HEAD_C = COLS - 1;
const HEAD_R = 5;

/** The tile the drop lands on, one row down in the head's own column. */
const LANDING_C = HEAD_C;
const LANDING_R = HEAD_R + 1;

/** The charge the landing node is posed at: the value every wrong model misses. */
const LANDING_CHARGE = 2;

/** How long the step may take before the sweep gives up, in frames. */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lands the head on the tile the node stands on, keeping its vertical heading", async () => {
  startPlaying(h);
  h.debug.setNode(LANDING_C, LANDING_R, LANDING_CHARGE);
  const id = poseWorm(h, HEAD_C, HEAD_R, 1, 1, 1);

  const swept = await h.until((s) => !segmentAt(s, HEAD_C, HEAD_R), {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "landed");

  assertEqual(
    swept.hit,
    true,
    `the head to leave tile (${HEAD_C}, ${HEAD_R}) within ${STEP_TIMEOUT} frames`,
  );
  const worm = wormOf(swept.snapshot, id);
  assertDeepEqual(
    headOf(worm),
    { c: LANDING_C, r: LANDING_R },
    "the head on the tile the charge-2 node stands on",
  );
  assertEqual(
    worm.dv,
    1,
    "dv after the drop: only a horizontal step can be blocked, so the node " +
      "below turns nothing",
  );
});
