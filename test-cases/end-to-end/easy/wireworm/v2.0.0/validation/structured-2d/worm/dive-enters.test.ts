// worm/dive-enters — a block by a critical node starts a dive.
//
// specs/worm.md, Diving: "A block by a node at charge `3`, the critical charge,
// starts a dive when the head is above the player band, which is any row above
// row `BAND_TOP_ROW` (`18`). The step that starts the dive sets `diving` and
// moves the head one row down, to `(c, r + 1)`, staying in its column."
//
// WHAT MAKES THIS A POINT OF ITS OWN. The head lands on the same tile a
// non-critical block would have dropped it to (`worm.blocked-by-node-drops`),
// so the tile alone cannot tell a dive from a turn. The `diving` FLAG is what
// separates them, and it is read here beside the tile.
//
// THE BLOCKER IS POSED AT `CHARGE_MAX` — `3`, the critical charge, the one
// value that starts a dive. The head is posed on row 5, well above
// `BAND_TOP_ROW`, so the row condition is met with room to spare and a failure
// cannot be blamed on the band; a critical block from row `18` or `19` turns
// the worm the ordinary way, and that is a different arrangement of the rule.
//
// The worm is ONE segment on an otherwise empty, quiet board, so nothing but
// the critical block can decide the step.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_TOP_ROW, CHARGE_MAX, WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormById,
  wormOn,
  type Harness,
} from "../harness";

/** Where the head is posed, and the tile whose critical node blocks it. */
const START_C = 10;
const START_R = 5;
const BLOCKER_C = START_C + 1;

/**
 * How long the step may take before the drive gives up, in frames. Four of
 * level 1's `WORM_STEP_L1` (`0.14` s) intervals — a timeout, not a tolerance.
 */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets diving and drops one row when a critical node blocks it", async () => {
  // The scenario is only the rule's if the head really is above the band.
  assertLessThan(START_R, BAND_TOP_ROW, "the posed row is above the band");

  startPlaying(h);
  h.debug.setNode(BLOCKER_C, START_R, CHARGE_MAX);
  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  const swept = await h.until(
    (s) => wormOn(s, START_C, START_R) === undefined,
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );

  captureStill(h, "diving");

  assertEqual(
    swept.hit,
    true,
    `the head to leave (${START_C}, ${START_R}) within ${STEP_TIMEOUT} frames`,
  );
  assertDeepEqual(
    wormById(swept.snapshot, id)?.segments,
    [{ c: START_C, r: START_R + 1 }],
    "the head one row down, in its own column",
  );
  assertEqual(wormById(swept.snapshot, id)?.diving, true, "diving");
});
