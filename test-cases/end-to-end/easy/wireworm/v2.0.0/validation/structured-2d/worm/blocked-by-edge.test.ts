// worm/blocked-by-edge — the side edge of the board blocks and turns the worm.
//
// specs/worm.md, Winding: a horizontal step is blocked when the target tile is
// "off the board, which is a column outside `0` to `39`", and the turn a block
// produces reverses `dh` and moves the head one row in `dv`. specs/worm.md
// closes the rule with "A worm never leaves the board through an edge."
//
// BOTH EDGES ARE DRIVEN. The two are separate arrangements of the one rule —
// column `0` reached heading left, column `COLS - 1` (`39`) reached heading
// right — and a build that guards one bound and not the other is right about
// half the board. Each is posed on its own, on a cleared board, so a failure
// names the edge.
//
// NO NODE IS POSED. The edge is the blocker, and putting a node anywhere near
// it would leave a failure unable to say which of the two rules the build got
// wrong. The heads are posed on row 5 with `dv` down, so `r + dv` is on the
// board and no vertical flip is in play (`worm.oscillates-at-floor` is that
// rule).

import { afterEach, beforeEach, it } from "vitest";
import { COLS, WORM_STEP_L1 } from "../../src/constants";
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

/** The row both heads are posed on: clear, and clear of the floor. */
const START_R = 5;

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

/**
 * Pose a one-segment worm on the edge column `c` heading off the board, take
 * its one step, and answer the worm the step left behind.
 */
async function turnedAtEdge(
  c: number,
  dh: number,
): Promise<WormSnapshot | undefined> {
  h.debug.clearWorms();
  const id = poseWorm(h, c, START_R, 1, dh, 1);

  const swept = await h.until((s) => wormOn(s, c, START_R) === undefined, {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });
  assertEqual(
    swept.hit,
    true,
    `column ${c}: the head to leave (${c}, ${START_R}) within ${STEP_TIMEOUT} frames`,
  );
  return wormById(swept.snapshot, id);
}

it("drops and reverses a worm heading into either side edge", async () => {
  startPlaying(h);

  const atLeft = await turnedAtEdge(0, -1);
  captureStill(h, "edge");
  assertDeepEqual(
    atLeft?.segments,
    [{ c: 0, r: START_R + 1 }],
    "heading off column 0: the head one row on, in its own column",
  );
  assertEqual(atLeft?.dh, 1, "heading off column 0: dh");

  const atRight = await turnedAtEdge(COLS - 1, 1);
  assertDeepEqual(
    atRight?.segments,
    [{ c: COLS - 1, r: START_R + 1 }],
    `heading off column ${COLS - 1}: the head one row on, in its own column`,
  );
  assertEqual(atRight?.dh, -1, `heading off column ${COLS - 1}: dh`);
});
