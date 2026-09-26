// worm/step-quickens — the reported step interval follows the level's formula.
//
// specs/worm.md, The step clock: the interval is the level's, and it shortens
// as the run climbs —
//
//   wormStepInterval(level) =
//     max(WORM_STEP_FLOOR, WORM_STEP_L1 * WORM_STEP_DECAY ^ (level - 1))
//
// with `WORM_STEP_L1` (`0.14`), `WORM_STEP_DECAY` (`0.95`) and
// `WORM_STEP_FLOOR` (`0.07`), all in seconds. specs/instrumentation.md fixes
// `wormStepInterval` as a snapshot entry "built at the call" from `level`, so
// posing the level and reading the snapshot back is the whole of the reading:
// no frame has to run between them.
//
// EVERY LEVEL OF THE RUN IS READ, 1 through `TOTAL_LEVELS`. The whole closed
// form is what is asserted, the floor included — and the floor never binds
// inside a run, since level 12 is `0.0796` s and the expression would first
// cross `0.07` at level 15. That is why there is no separate floor point and
// why `setLevel`'s domain stays the game's own `1..12` rather than being
// widened to reach one.
//
// This point reads the REPORT and nothing else. Whether the worm really steps
// at that cadence is `worm.step-cadence`'s requirement, measured at level 1,
// and no worm is posed here at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  TOTAL_LEVELS,
  WORM_STEP_DECAY,
  WORM_STEP_FLOOR,
  WORM_STEP_L1,
} from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far a reported interval may fall from the closed form, in seconds.
 *
 * The manifest states this figure. It is a rounding allowance and nothing more:
 * consecutive levels are `0.007` s apart at the top of the run — level 11's
 * `0.0838` s against level 12's `0.0796` s — so `0.002` s is under a third of
 * the gap between neighbouring levels and cannot let a build off by a level.
 */
const TOLERANCE = 0.002;

/** The closed form specs/worm.md states, written out from the three figures. */
function expectedInterval(level: number): number {
  return Math.max(
    WORM_STEP_FLOOR,
    WORM_STEP_L1 * Math.pow(WORM_STEP_DECAY, level - 1),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the level's step interval at every level of the run", async () => {
  startPlaying(h);

  /** What the build reported at each level, read in one pass, no frames run. */
  const reported: number[] = [];
  for (let level = 1; level <= TOTAL_LEVELS; level += 1) {
    h.debug.setLevel(level);
    reported.push(h.snapshot().wormStepInterval);
  }

  // The board as the last level timed left it, drawn once so the still exists.
  h.debug.setLevel(TOTAL_LEVELS);
  await h.advance(1);
  captureStill(h, "levels");

  for (let level = 1; level <= TOTAL_LEVELS; level += 1) {
    const expected = expectedInterval(level);
    assertLessThanOrEqual(
      Math.abs(reported[level - 1] - expected),
      TOLERANCE,
      `level ${level}: wormStepInterval within ${TOLERANCE} s of ${expected}`,
    );
  }
});
