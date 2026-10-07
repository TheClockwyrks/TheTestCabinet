// lamplighter/move-speed — one held second of ArrowRight moves the lamplighter
// exactly MOVE_SPEED units, MOVE_STEP of them on every tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The lamplighter") fixes
// "Base move speed, units per second | `MOVE_SPEED` | `180`", and "Movement"
// fixes how it is applied: "The velocity is that direction times `moveSpeed`,
// and each tick the position advances by the velocity times `TICK_DT`", with
// "`moveSpeed` is `MOVE_SPEED` times the speed multiplier `specs/passives.md`
// defines, so with no Bellows held it is `MOVE_SPEED`". specs/overview.md fixes
// `TICK_DT` at `1/60`, so a tick of ArrowRight alone moves the lamplighter
// `MOVE_STEP` (`180 / 60 = 3`) units along `+x`, and `TICK_HZ` (`60`) ticks of
// it move it `180`. Both figures are asserted: the step on every tick, and the
// total over the second.
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone at the origin,
// no passive held, so `moveSpeed` is the base figure; every driver switch off,
// nothing alive, and the level out of reach, so the second runs on `playing`
// from its first tick to its last. The key is a real key event through
// Chromium's input pipeline.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on each per-tick step and on the total,
// the case's allowance for a position integrated over ticks: `MOVE_STEP` is
// exact, but a build that multiplies `180` by an inexact `1/60` on every tick
// drifts by a few `1e-13` per tick, and `1e-6` is four orders below the finest
// position the specification distinguishes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOVE_SPEED, MOVE_STEP, POSITION_TOL, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  displacement,
  holdKeysWatching,
  isolate,
  tickSteps,
  type Harness,
} from "../harness";

/** One second of game time: `TICK_HZ` ticks. */
const HOLD_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the lamplighter MOVE_STEP units on every tick of a held second, MOVE_SPEED in all", async () => {
  const opened = await isolate(h);
  assertEqual(
    opened.run.passives.length,
    0,
    "the passives held, so moveSpeed is the base figure",
  );

  const ticks = await captureReplay(h, "second", () =>
    holdKeysWatching(h, ["ArrowRight"], HOLD_TICKS),
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
      MOVE_STEP,
      POSITION_TOL,
      `the lamplighter's step along x on tick ${i + 1} of the hold, in units`,
    );
    assertNear(
      step.y,
      0,
      POSITION_TOL,
      `the lamplighter's step along y on tick ${i + 1} of the hold, in units`,
    );
  });

  const moved = displacement(opened, ticks[HOLD_TICKS - 1]!);
  assertNear(
    moved.x,
    MOVE_SPEED,
    POSITION_TOL,
    `the lamplighter's movement along x over one held second, in units`,
  );
});
