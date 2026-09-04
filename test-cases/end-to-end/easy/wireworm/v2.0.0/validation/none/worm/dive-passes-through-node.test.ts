// worm/dive-passes-through-node — a diving worm advances one row per step down its
// own column, through whatever stands in it.
//
// specs/worm.md, "Diving": "While a worm is diving, each step advances the head
// one tile down its own column, to `(c, r + 1)`, whatever stands on the tile it
// enters. The tile's node or segment is left exactly as it was, and neither turns
// the worm nor is destroyed. The horizontal heading is unchanged throughout."
//
// THE DIVE IS POSED, NOT EARNED. `setWormDiving` sets the flag directly
// (specs/instrumentation.md), so the scenario is reached without a critical node
// to start it — which is `worm.dive-enters`'s requirement and would grade it
// twice. The world therefore holds the column of nodes the dive crosses and one
// head, and nothing else.
//
// THE NODES ARE POSED AT CHARGE 2, AND THAT VALUE IS LOAD-BEARING. `2` is the one
// charge from which every wrong model reads as its own board: a build that let the
// node block the dive leaves the head where it was, a build that treated the dive
// as a bump would climb it toward critical and start a second dive, and a build
// that detonated it would clear the column. What the charges are afterwards is
// `nodes.dive-leaves-charge`'s requirement; this point reads the head's tile.
//
// The dive runs from row `5` to row `8`, all far above `BAND_TOP_ROW` (`18`), so
// nothing here can be decided by where a dive ends — that is
// `worm.dive-ends-at-band`'s requirement.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
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
  type UntilResult,
} from "../harness";

/** The column the dive runs down, and the row the head starts on. */
const COLUMN = 12;
const START_R = 5;

/** Steps driven, so the head crosses rows 6, 7 and 8. */
const STEPS = 3;

/** The charge every node in the column is posed at. */
const NODE_CHARGE = 2;

/**
 * How long one step may take before the sweep gives up, in frames. Four of level
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

it("advances the diving head onto each charged tile below it", async () => {
  await startPlaying(h);
  for (let step = 1; step <= STEPS; step += 1) {
    await h.debug.setNode(COLUMN, START_R + step, NODE_CHARGE);
  }
  const id = await poseWorm(h, {
    c: COLUMN,
    r: START_R,
    length: 1,
    diving: true,
  });

  const steps: UntilResult[] = [];
  for (let step = 1; step <= STEPS; step += 1) {
    const from = { c: COLUMN, r: START_R + step - 1 };
    steps.push(
      await h.until(
        (s) =>
          !segmentTiles(s).some(
            (tile) => tile.c === from.c && tile.r === from.r,
          ),
        { maxFrames: STEP_TIMEOUT, poll: 1 },
      ),
    );
  }
  await captureStill(h, "diving");

  for (let step = 1; step <= STEPS; step += 1) {
    const swept = steps[step - 1];
    assertEqual(
      swept.hit,
      true,
      `step ${step}: the head to leave tile (${COLUMN}, ${START_R + step - 1}) ` +
        `within ${STEP_TIMEOUT} frames`,
    );
    assertDeepEqual(
      headOf(requireWorm(swept.snapshot, id, `dive step ${step}`)),
      { c: COLUMN, r: START_R + step },
      `after dive step ${step}: the head one row lower, on the tile the ` +
        "charge-2 node stands on",
    );
  }
});
