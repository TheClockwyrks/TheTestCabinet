// worm/step-quickens — the step interval shortens with the level, by the closed
// form the specification states.
//
// specs/worm.md, "The step clock": "The interval is the level's, and it shortens
// as the run climbs:
//
//   wormStepInterval(level) =
//     max(WORM_STEP_FLOOR, WORM_STEP_L1 * WORM_STEP_DECAY ^ (level - 1))
//
// with `WORM_STEP_L1` (`0.14`), `WORM_STEP_DECAY` (`0.95`), and `WORM_STEP_FLOOR`
// (`0.07`), all in seconds. Level 1 steps every `0.14` s and level 12 every
// `0.0796` s." specs/instrumentation.md has the snapshot report `wormStepInterval`
// as "seconds per tile step at this level, derived from `level`", and has
// `setLevel` "spawn nothing and clear nothing", so the figure follows the level
// with no play in between.
//
// THE WHOLE CLOSED FORM IS CHECKED, FLOOR INCLUDED. It is written out here from
// the three named figures rather than taken from a helper, so what the check holds
// the build to is the formula the spec states. The floor never binds inside a run
// — `0.14 * 0.95 ^ 11` is `0.0796` s at level 12, and the form would first cross
// `0.07` at level 15 — so the `max` is asserted as the spec writes it and
// `setLevel`'s domain stays the game's own `1..TOTAL_LEVELS`.
//
// NOTHING IS DRIVEN. The interval is a READING of the level, so the scenario poses
// each level and reads the snapshot; how the worm then steps on that interval is
// `worm.step-cadence`'s requirement, and posing a worm here would grade it twice.

import { afterEach, beforeEach, it } from "vitest";
import {
  TOTAL_LEVELS,
  WORM_STEP_DECAY,
  WORM_STEP_FLOOR,
  WORM_STEP_L1,
} from "../constants";
import { assertBetween } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * The seconds a step is due to take at `level`, straight off the closed form
 * specs/worm.md states.
 */
function dueInterval(level: number): number {
  return Math.max(
    WORM_STEP_FLOOR,
    WORM_STEP_L1 * Math.pow(WORM_STEP_DECAY, level - 1),
  );
}

/**
 * How far a reported interval may sit from the closed form, in seconds.
 *
 * The figure is a derived number rather than a measurement, so this is room for
 * how a build spells the arithmetic — a repeated multiplication down the levels
 * against a single `Math.pow`, say — and nothing more. `0.002` s is 1.4% of the
 * level-1 interval and a quarter of the `0.0074` s gap between two neighbouring
 * levels at the bottom of the run, so no build that skipped a level's worth of
 * decay, or applied it the wrong way, fits inside it.
 */
const TOLERANCE = 0.002;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reports the closed form's interval at each of the twelve levels", async () => {
  await startPlaying(h);

  /** What the snapshot reported at each level, indexed from level 1. */
  const reported: number[] = [];
  for (let level = 1; level <= TOTAL_LEVELS; level += 1) {
    await h.debug.setLevel(level);
    reported.push((await h.snapshot()).wormStepInterval);
  }

  // One frame at the last level timed, so the still is a board rather than a
  // canvas nothing has drawn to yet.
  await h.advance(1);
  await captureStill(h, "levels");

  for (let level = 1; level <= TOTAL_LEVELS; level += 1) {
    const due = dueInterval(level);
    assertBetween(
      reported[level - 1],
      due - TOLERANCE,
      due + TOLERANCE,
      `the wormStepInterval reported at level ${level}`,
    );
  }
});
