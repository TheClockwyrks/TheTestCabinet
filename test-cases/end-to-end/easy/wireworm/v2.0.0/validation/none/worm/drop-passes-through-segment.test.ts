// worm/drop-passes-through-segment — the drop a block produces enters the tile
// below whatever stands there, a worm segment included.
//
// specs/worm.md, "Winding": "Only a horizontal step can be blocked. The vertical
// move a block produces always takes the head into the tile at `(c, r + dv)`,
// whatever stands there. A node or a worm segment on that tile neither turns the
// worm nor is destroyed by it."
//
// THE WORLD IS TWO HEADS AND NOTHING ELSE. `startPlaying` leaves the board empty
// and the three world gates shut. The scenario puts back the segment the drop
// lands on — one worm of a single segment with its STEP faculty off, which
// specs/instrumentation.md states leaves it standing while "the rest of the board
// runs on", so it cannot travel into or out of the landing tile — and the moving
// worm one row above it, also a single segment.
//
// THE BLOCK IS THE BOARD'S EDGE, AND THAT IS DELIBERATE. A drop needs a block, and
// of the three things that block a step — the edge, a node, a segment — only the
// edge adds NOTHING to the world. So the only thing on the board besides the
// moving head is the segment the requirement is about. The edge rule itself is
// graded by `worm.blocked-by-edge`.
//
// The head is on row `5`, so `r + dv` is row `6`: far above the floor, and the
// vertical heading has no reason to flip.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  headOf,
  poseWorm,
  requireWorm,
  segmentTiles,
  startPlaying,
  type Harness,
} from "../harness";

/** The head, on the last column and heading outward, so the edge blocks it. */
const HEAD_C = COLS - 1;
const HEAD_R = 5;

/** The tile the drop lands on, where the stationary worm's segment stands. */
const LANDING_C = HEAD_C;
const LANDING_R = HEAD_R + 1;

/**
 * How long the step may take before the sweep gives up, in frames. Four of level
 * 1's `WORM_STEP_L1` (`0.14` s) intervals: a bound on a step that never happened,
 * not a tolerance on when it did.
 */
const STEP_TIMEOUT = framesFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("lands the head on the tile a stationary worm's segment stands on", async () => {
  await startPlaying(h);
  await poseWorm(h, {
    c: LANDING_C,
    r: LANDING_R,
    length: 1,
    stepping: false,
  });
  const id = await poseWorm(h, { c: HEAD_C, r: HEAD_R, length: 1 });

  const swept = await h.until(
    (s) =>
      !segmentTiles(s).some((tile) => tile.c === HEAD_C && tile.r === HEAD_R),
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );
  await captureStill(h, "landed");

  assertEqual(
    swept.hit,
    true,
    `the head to leave tile (${HEAD_C}, ${HEAD_R}) within ${STEP_TIMEOUT} frames`,
  );
  // A build that let the segment block the drop leaves the head on row 5.
  assertDeepEqual(
    headOf(requireWorm(swept.snapshot, id, "the drop onto the segment")),
    { c: LANDING_C, r: LANDING_R },
    "the head on the tile the standing segment occupies",
  );
});
