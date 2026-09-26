// worm/dive-enters — a block by a critical node starts a dive.
//
// specs/worm.md, "Diving": "A block by a node at charge `3`, the critical charge,
// starts a dive when the head is above the player band, which is any row above row
// `BAND_TOP_ROW` (`18`). The step that starts the dive sets `diving` and moves the
// head one row down, to `(c, r + 1)`, staying in its column."
//
// THE NODE IS AT CHARGE 3, AND THE HEAD IS HIGH ABOVE THE BAND. Row `5` is
// thirteen rows above `BAND_TOP_ROW`, so the clause that turns a critical block
// into an ordinary turn — the head already on row `18` or `19` — cannot be what
// decided the reading.
//
// THE WORLD IS ONE NODE AND ONE HEAD. `startPlaying` leaves the board empty and
// the three world gates shut, and the scenario puts back the critical node and a
// one-segment worm one tile short of it, heading into it. A one-segment worm has
// no body to follow, so the head is the only thing that moved.
//
// WHAT THIS DOES NOT DECIDE. Where a dive goes from here is
// `worm.dive-passes-through-node`'s requirement and where it ends is
// `worm.dive-ends-at-band`'s. The node's own charge is `nodes.bump-caps`'s. This
// point reads the step that starts the dive.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, WORM_STEP_L1 } from "../constants";
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

/** The tile the critical node stands on: far above the band, clear of the edges. */
const NODE_C = 12;
const NODE_R = 5;

/** The head, one tile short of the node and heading into it. */
const HEAD_C = NODE_C - 1;
const HEAD_R = NODE_R;

/** How long the step may take before the sweep gives up, in frames. */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets diving and drops the head a row when a critical node blocks it", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, CHARGE_MAX);
  const id = poseWorm(h, HEAD_C, HEAD_R, 1, 1, 1);

  const swept = await h.until((s) => !segmentAt(s, HEAD_C, HEAD_R), {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "diving");

  assertEqual(
    swept.hit,
    true,
    `the head to leave tile (${HEAD_C}, ${HEAD_R}) within ${STEP_TIMEOUT} frames`,
  );
  const worm = wormOf(swept.snapshot, id);
  assertEqual(
    worm.diving,
    true,
    "diving after the step a critical node blocked, posed false",
  );
  assertDeepEqual(
    headOf(worm),
    { c: HEAD_C, r: HEAD_R + 1 },
    "the head one row down, staying in its own column",
  );
});
