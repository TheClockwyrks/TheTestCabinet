// worm/blocked-by-edge — the board's side edge blocks a horizontal step, and the
// worm drops one row and reverses.
//
// specs/worm.md, "Winding": a horizontal step is blocked when the target tile is
// "off the board, which is a column outside `0` to `39`", and a blocked step
// reverses `dh` and moves the head one row in its vertical heading, "staying in
// its own column". The closing rule of the section is what this point holds a
// build to: "A worm never leaves the board through an edge."
//
// BOTH EDGES, ONE POINT. The left edge and the right edge are the same bound
// mirrored, exercised the same way, so they share a validator: a build that walks
// off one walks off the other. They are posed as two scenarios rather than as two
// worms in one world, with `reset` between them, so neither can reach the other.
//
// THE WORLD IS ONE HEAD AGAINST AN EDGE. `startPlaying` leaves the board empty and
// the three world gates shut, and each scenario puts back one worm of a SINGLE
// segment on the edge column, heading outward. Nothing else is on the board, so
// the only thing that can block the step is the edge itself — no node, no segment,
// and no body to follow.
//
// The row is `5`, high above the player band, so the vertical heading never has to
// flip: that is `worm.oscillates-at-floor`'s requirement and `worm.oscillates-at-
// top`'s, and a drop into row `6` is unambiguous here.

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
  type UntilResult,
} from "../harness";

/** The row both scenarios run on: clear, and far above the player band. */
const ROW = 5;

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

/**
 * Pose one head on `column` heading `dh` outward, and run the step it is blocked
 * on.
 *
 * The harness is reset first, so each scenario opens on the world `startPlaying`
 * poses and neither carries anything of the other's.
 */
async function driveIntoEdge(
  column: number,
  dh: number,
): Promise<{ id: number; swept: UntilResult }> {
  await h.debug.reset();
  await startPlaying(h);
  const id = await poseWorm(h, { c: column, r: ROW, length: 1, dh });
  const swept = await h.until(
    (s) => !segmentTiles(s).some((tile) => tile.c === column && tile.r === ROW),
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );
  return { id, swept };
}

it("turns the worm at either side edge rather than letting it leave the board", async () => {
  const left = await driveIntoEdge(0, -1);
  const right = await driveIntoEdge(COLS - 1, 1);
  await captureStill(h, "edge");

  for (const [name, column, dh, read] of [
    ["the left edge", 0, -1, left],
    ["the right edge", COLS - 1, 1, right],
  ] as const) {
    assertEqual(
      read.swept.hit,
      true,
      `${name}: the head to leave tile (${column}, ${ROW}) within ${STEP_TIMEOUT} frames`,
    );
    const worm = requireWorm(read.swept.snapshot, read.id, name);
    assertDeepEqual(
      headOf(worm),
      { c: column, r: ROW + 1 },
      `${name}: the head one row on, holding its own column`,
    );
    assertEqual(worm.dh, -dh, `${name}: dh after the step, posed at ${dh}`);
  }
});
