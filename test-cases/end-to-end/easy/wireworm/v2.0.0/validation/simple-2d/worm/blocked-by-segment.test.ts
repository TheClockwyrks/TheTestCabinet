// worm/blocked-by-segment — a worm segment blocks a horizontal step, and the worm
// drops one row and reverses.
//
// specs/worm.md, "Winding": a horizontal step is blocked when the target tile is
// "a tile holding a worm segment, of this worm or of any other", and a blocked
// step reverses `dh` and moves the head one row in its vertical heading, "staying
// in its own column".
//
// THE WORLD IS TWO HEADS AND NOTHING ELSE. `startPlaying` leaves the board empty
// and the three world gates shut. The scenario puts back the blocker — one worm of
// a single segment with its STEP faculty off, which specs/instrumentation.md
// states leaves it standing while "the rest of the board runs on" — and the moving
// worm, also a single segment, one tile short of it and heading into it. The
// blocker cannot wander into or out of the scenario, neither worm has a body to
// follow, and no node stands anywhere, so the tile ahead is blocked by a segment
// and by nothing else.
//
// The row is `5`, far above the player band, so the vertical heading never has to
// flip, and both worms are far from either side edge.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
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

/** The tile the stationary blocker's one segment stands on. */
const BLOCKER_C = 12;
const BLOCKER_R = 5;

/** The moving head, one tile short of the blocker and heading into it. */
const HEAD_C = BLOCKER_C - 1;
const HEAD_R = BLOCKER_R;

/** How long the step may take before the sweep gives up, in frames. */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the worm on a tile another worm's segment stands on", async () => {
  startPlaying(h);
  const blocker = poseWorm(h, BLOCKER_C, BLOCKER_R, 1, 1, 1);
  h.debug.setWormStepping(blocker, false);
  const id = poseWorm(h, HEAD_C, HEAD_R, 1, 1, 1);

  const swept = await h.until((s) => !segmentAt(s, HEAD_C, HEAD_R), {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "segment");

  assertEqual(
    swept.hit,
    true,
    `the head to leave tile (${HEAD_C}, ${HEAD_R}) within ${STEP_TIMEOUT} frames`,
  );
  const worm = wormOf(swept.snapshot, id);
  // A build that walked through the segment reads (12, 5) instead.
  assertDeepEqual(
    headOf(worm),
    { c: HEAD_C, r: HEAD_R + 1 },
    "the head one row on, holding its own column",
  );
  assertEqual(
    worm.dh,
    -1,
    "dh after the step the segment blocked, posed at +1",
  );
});
