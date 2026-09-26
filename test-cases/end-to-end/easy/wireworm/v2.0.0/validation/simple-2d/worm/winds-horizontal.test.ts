// worm/winds-horizontal — on a clear row the head advances one tile per step.
//
// specs/worm.md, "Winding": "The head attempts to move one tile horizontally, to
// the tile at `(c + dh, r)`", and where nothing blocks it "the head moves to that
// tile and the worm holds its row and both headings". A horizontal step is blocked
// only by the board's edge, by a node, or by a worm segment.
//
// THE WORLD IS ONE HEAD ON A CLEAR ROW. `startPlaying` leaves the board empty and
// the three world gates shut, and the scenario puts back exactly one worm of a
// SINGLE segment. Nothing on the board can block the step, there is no body to
// follow — that is `worm.body-follows`'s requirement — and no other entity exists
// to reach into the scenario. Where the head lands is decided by the winding rule
// and by nothing else.
//
// NOTHING HERE MEASURES THE RATE. Each step is WAITED FOR rather than timed: the
// drive runs frames until the head has left the tile it stood on, under a timeout
// four intervals wide. A build stepping on the wrong interval is docked by
// `worm.step-cadence` and `worm.step-quickens`, and this point still reads only
// what it is about — which tile the head went to, and that it held its row and
// both headings on the way.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseWorm,
  segmentAt,
  startPlaying,
  ticksFor,
  wormOf,
  type Harness,
  type UntilResult,
} from "../harness";

/** Where the head is posed: a clear row, well inside both side edges. */
const START_C = 10;
const START_R = 5;

/** Steps driven. Four carries the head to column 14, nowhere near an edge. */
const STEPS = 4;

/**
 * How long one step may take before the sweep gives up, in frames.
 *
 * Four times `WORM_STEP_L1` (`0.14` s, the level-1 interval specs/worm.md fixes),
 * which is a bound no build clocking the worm on the level's own interval comes
 * near. It is a TIMEOUT rather than a tolerance: reaching it means the head never
 * left its tile at all, which is a step that never happened.
 */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the head one tile per step along its heading", async () => {
  startPlaying(h);
  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  /** What the board looked like the moment each step landed. */
  const steps: UntilResult[] = [];

  await captureReplay(h, "winding", async () => {
    for (let step = 1; step <= STEPS; step += 1) {
      // The tile the head stands on going into this step. The world holds one
      // worm of one segment, so "no segment on that tile" is "the head left it".
      const from = { c: START_C + step - 1, r: START_R };
      steps.push(
        await h.until((s) => !segmentAt(s, from.c, from.r), {
          maxFrames: STEP_TIMEOUT,
          poll: 1,
        }),
      );
    }
    // A settle, inside the bracket: two further steps' worth of frames, so a
    // reviewer watching this replay sees the worm travel ON rather than the
    // recording cutting to black on the frame the last step landed. Half an
    // interval past the second of them, which is the furthest point from a
    // step boundary. Every reading above was taken before it, so no verdict
    // moves.
    await h.advance(ticksFor(WORM_STEP_L1 * 2.5));
  });

  for (let step = 1; step <= STEPS; step += 1) {
    const swept = steps[step - 1];
    assertEqual(
      swept.hit,
      true,
      `step ${step}: the head to leave tile ` +
        `(${START_C + step - 1}, ${START_R}) within ${STEP_TIMEOUT} frames`,
    );
    const worm = wormOf(swept.snapshot, id);
    assertDeepEqual(
      worm.segments,
      [{ c: START_C + step, r: START_R }],
      `after step ${step}: the head one tile on along dh, holding its row`,
    );
    assertEqual(worm.dh, 1, `after step ${step}: dh`);
    assertEqual(worm.dv, 1, `after step ${step}: dv`);
  }
});
