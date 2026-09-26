// worm/dive-ends-at-band — a dive that reaches the band clears `diving` and the
// worm winds again.
//
// specs/worm.md, Diving: "The dive ends at the end of the step in which the
// head reaches row `BAND_TOP_ROW` (`18`) or row `19`. `diving` clears, and the
// worm winds normally from the next step."
//
// THE DRIVE IS THREE STEPS, and each of the three is what makes the point
// decidable:
//
//   1. From row 16 to row 17: still short of the band, so `diving` is still set
//      — which is what says the dive was really running rather than never
//      started, and stops a build that clears the flag on the first step of any
//      dive from passing the two readings below by accident.
//   2. From row 17 to row 18: the band is reached, and `diving` clears.
//   3. The step after: the worm WINDS, one tile along its horizontal heading,
//      holding row 18 — which is what "winds normally from the next step"
//      means, and what a build that merely stopped descending would fail.
//
// THE WORLD THIS POSES. An empty, quiet board and a worm of ONE segment posed
// diving with `setWormDiving`, in a column with nothing in it and nothing
// beside it. Starting the dive off a critical node instead would put
// `worm.dive-enters`' requirement in front of this one. The column is clear of
// the cursor's own, and the cursor's contact test is off, so the band decides
// nothing here but the end of the dive.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_TOP_ROW, WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormById,
  wormOn,
  type Harness,
  type WormSnapshot,
} from "../harness";

/** Where the head is posed: two rows above the band, in a clear column. */
const START_C = 8;
const START_R = BAND_TOP_ROW - 2;

/**
 * How long one step may take before the drive gives up, in frames. Four of
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

it("clears diving at the band and winds from the next step", async () => {
  startPlaying(h);
  const id = poseWorm(h, START_C, START_R, 1, 1, 1);
  h.debug.setWormDiving(id, true);

  /** Where the head stands before each of the three steps. */
  const from: { c: number; r: number }[] = [
    { c: START_C, r: START_R },
    { c: START_C, r: START_R + 1 },
    { c: START_C, r: BAND_TOP_ROW },
  ];
  const seen: (WormSnapshot | undefined)[] = [];

  for (const tile of from) {
    const swept = await h.until(
      (s) => wormOn(s, tile.c, tile.r) === undefined,
      { maxFrames: STEP_TIMEOUT, poll: 1 },
    );
    seen.push(swept.hit ? wormById(swept.snapshot, id) : undefined);
    if (!swept.hit) break;
  }

  captureStill(h, "resumed");

  for (let step = 1; step <= from.length; step += 1) {
    assertEqual(
      seen[step - 1] !== undefined,
      true,
      `step ${step} taken within ${STEP_TIMEOUT} frames, and the worm still on the board`,
    );
  }

  // 1: the dive is still running one row short of the band.
  assertDeepEqual(
    seen[0]?.segments,
    [{ c: START_C, r: START_R + 1 }],
    "after the first dive step: the head one row down its column",
  );
  assertEqual(seen[0]?.diving, true, "one row short of the band: diving");

  // 2: the band is reached, and the dive ends with that step.
  assertDeepEqual(
    seen[1]?.segments,
    [{ c: START_C, r: BAND_TOP_ROW }],
    "after the dive reaches the band: the head on row 18",
  );
  assertEqual(seen[1]?.diving, false, "on reaching the band: diving");

  // 3: the worm winds again, one tile along its heading, holding its row.
  assertDeepEqual(
    seen[2]?.segments,
    [{ c: START_C + 1, r: BAND_TOP_ROW }],
    "the step after: the head one tile along its heading, holding row 18",
  );
  assertEqual(seen[2]?.diving, false, "the step after: diving");
});
