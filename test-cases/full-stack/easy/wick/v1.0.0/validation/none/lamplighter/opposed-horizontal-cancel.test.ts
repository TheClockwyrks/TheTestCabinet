// lamplighter/opposed-horizontal-cancel — ArrowLeft and ArrowRight held together leave
// player.x where it is, tick over tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The movement
// direction is the sum of the unit vectors of the held actions, `up` `(0, -1)`,
// `down` `(0, 1)`, `left` `(-1, 0)`, and `right` `(1, 0)`, normalized to unit
// length when the sum is non-zero", and "two opposite actions held together
// cancel to no movement on that axis". With `left` and `right` held and nothing
// else the sum is `(0, 0)`, so the velocity is zero and `player.x` does not
// change on any tick of the hold. specs/controls.md binds the two to `ArrowLeft`
// and `ArrowRight`, each "held on `playing`".
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone at the origin,
// every driver switch off, nothing alive, and the level out of reach, so
// nothing but the two keys can move it. Both keys are real key events, both
// down before the first frame of the hold runs and both up only after its last,
// so every tick of the hold reads both.
//
// WHAT IS READ. `player.x` after each of `HOLD_TICKS` frames against the tick
// before, within `POSITION_TOL` (`1e-6`), the case's allowance for a position
// integrated over ticks. A build that lets one of the two keys win moves
// `MOVE_STEP` (`3`) units on every tick, six orders outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds player.x on every tick ArrowLeft and ArrowRight are held together", async () => {
  const opened = await isolate(h);

  const ticks = await captureReplay(h, "cancel", () =>
    holdKeysWatching(h, ["ArrowLeft", "ArrowRight"], HOLD_TICKS),
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
      0,
      POSITION_TOL,
      `the lamplighter's step along x on tick ${i + 1} of the ArrowLeft + ArrowRight hold, in units`,
    );
  });
});
