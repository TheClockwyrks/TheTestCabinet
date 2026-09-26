// lamplighter/diagonal-equals-cardinal — two perpendicular keys held together
// move the lamplighter along the normalized diagonal at the cardinal speed.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The movement
// direction is the sum of the unit vectors of the held actions, `up` `(0, -1)`,
// `down` `(0, 1)`, `left` `(-1, 0)`, and `right` `(1, 0)`, normalized to unit
// length when the sum is non-zero. The velocity is that direction times
// `moveSpeed`, and each tick the position advances by the velocity times
// `TICK_DT`", and, in so many words, "Diagonal movement is therefore exactly as
// fast as cardinal movement". With `right` and `down` held the sum is `(1, 1)`,
// normalized `(1/√2, 1/√2)`, so with no Bellows held each tick moves the
// lamplighter `MOVE_STEP / √2` (`3 / √2 = 2.1213...`) along each of `+x` and
// `+y`: the length of that step is `MOVE_STEP`, the cardinal step. Both
// components are asserted on every tick, which decides the direction and the
// speed at once.
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone at the origin
// with no passive held, every driver switch off, nothing alive, and the level
// out of reach. The two keys are real key events, both down before the first
// frame of the hold runs and both up only after its last, so every tick of the
// hold reads both.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on each component of each step, the
// case's allowance for a position integrated over ticks. A build that moves
// `MOVE_STEP` along both axes, the unnormalized diagonal, is off by `0.88` units
// on every tick, six orders outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOVE_STEP, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  holdKeysWatching,
  isolate,
  tickSteps,
  type Harness,
} from "../harness";

/** Half a second of the hold, read one tick at a time. */
const HOLD_TICKS = 30;

/** Each component of one tick's step along the normalized `(1, 1)` diagonal. */
const DIAGONAL_STEP = MOVE_STEP / Math.SQRT2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the lamplighter MOVE_STEP / √2 along each axis on every tick ArrowRight and ArrowDown are held together", async () => {
  const opened = await isolate(h);
  assertEqual(
    opened.run.passives.length,
    0,
    "the passives held, so moveSpeed is the base figure",
  );

  const ticks = await captureReplay(h, "diagonal", () =>
    holdKeysWatching(h, ["ArrowRight", "ArrowDown"], HOLD_TICKS),
  );

  assertEqual(ticks.length, HOLD_TICKS, "the frames the hold ran");
  const steps = tickSteps(opened, ticks);
  steps.forEach((step, i) => {
    assertEqual(
      ticks[i]!.screen,
      "playing",
      `the screen on tick ${i + 1} of the hold`,
    );
    assertNear(
      step.x,
      DIAGONAL_STEP,
      POSITION_TOL,
      `the lamplighter's step along x on tick ${i + 1} of the diagonal hold, in units`,
    );
    assertNear(
      step.y,
      DIAGONAL_STEP,
      POSITION_TOL,
      `the lamplighter's step along y on tick ${i + 1} of the diagonal hold, in units`,
    );
  });
});
