// worm/dive-ends-at-band — a dive that reaches the player band clears `diving` and
// the worm winds normally again.
//
// specs/worm.md, "Diving": "The dive ends at the end of the step in which the head
// reaches row `BAND_TOP_ROW` (`18`) or row `19`. `diving` clears, and the worm
// winds normally from the next step."
//
// TWO STEPS, BECAUSE THE RULE HAS TWO HALVES. The first step carries the head from
// row `17` onto row `18` and must clear the flag; the second must be an ORDINARY
// step — one tile horizontally along `dh` (specs/worm.md, "Winding") — rather than
// another row down the column, which is what a build that never left its dive
// would take. A build that cleared the flag and kept driving downward, or that
// left the flag set and wound anyway, reads differently from both.
//
// THE DIVE IS POSED, NOT EARNED. `setWormDiving` sets the flag directly
// (specs/instrumentation.md), so nothing here depends on a critical node starting
// the dive — that is `worm.dive-enters`'s requirement.
//
// THE WORLD IS ONE HEAD. `startPlaying` leaves the board empty and the three world
// gates shut, the cursor's contact test included, which matters because row `18`
// is the top of the player band the cursor sits in. The worm is a single segment
// in mid-board columns, so the tile it winds into on the second step is clear and
// no body follows.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_TOP_ROW, WORM_STEP_L1 } from "../constants";
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

/** The head: one row above the band, in a mid-board column, heading right. */
const COLUMN = 12;
const START_R = BAND_TOP_ROW - 1;

/** How long one step may take before the sweep gives up, in frames. */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears diving on the step that reaches row 18 and winds from the next", async () => {
  startPlaying(h);
  const id = poseWorm(h, COLUMN, START_R, 1, 1, 1);
  h.debug.setWormDiving(id, true);

  const arriving = await h.until((s) => !segmentAt(s, COLUMN, START_R), {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });
  assertEqual(
    arriving.hit,
    true,
    `the head to leave tile (${COLUMN}, ${START_R}) within ${STEP_TIMEOUT} frames`,
  );
  const arrived = wormOf(arriving.snapshot, id);
  assertDeepEqual(
    headOf(arrived),
    { c: COLUMN, r: BAND_TOP_ROW },
    `the dive's last step, onto row ${BAND_TOP_ROW}`,
  );
  assertEqual(
    arrived.diving,
    false,
    `diving at the end of the step that reached row ${BAND_TOP_ROW}, posed true`,
  );

  const winding = await h.until((s) => !segmentAt(s, COLUMN, BAND_TOP_ROW), {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "resumed");

  assertEqual(
    winding.hit,
    true,
    `the head to leave tile (${COLUMN}, ${BAND_TOP_ROW}) within ${STEP_TIMEOUT} frames`,
  );
  // One tile along dh, holding its row: an ordinary wind. A build still diving
  // reads row 19 instead.
  assertDeepEqual(
    headOf(wormOf(winding.snapshot, id)),
    { c: COLUMN + 1, r: BAND_TOP_ROW },
    "the step after the dive ended: one tile on along dh, holding its row",
  );
});
