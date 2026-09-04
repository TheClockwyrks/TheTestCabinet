// Wick — passives/bellows-speed-mul: Bellows multiplies the lamplighter's move
// speed by `1 + 0.1` per level, and the walk moves by the scaled step.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`speedMul = 1 + BELLOWS_SPEED_PER_LEVEL × bellows`" with
// `BELLOWS_SPEED_PER_LEVEL` (`0.1`), and ("Move speed") "The lamplighter's move
// speed is `MOVE_SPEED` (`180`) times `speedMul`, in units per second, and the
// movement rule in `specs/world.md` integrates that speed each tick."
// `specs/world.md` ("Movement"): "The velocity is that direction times
// `moveSpeed`, and each tick the position advances by the velocity times
// `TICK_DT`". So at Bellows 2 the snapshot reads `180 × 1.2 = 216` and a held
// `ArrowRight` moves the lamplighter `216 / 60 = 3.6` units along `+x` on every
// tick. `specs/instrumentation.md` ("Snapshot shape") derives the reported
// `moveSpeed` by the same formula.
//
// THE POSE. An isolated night with Bellows 2 held through `setPassive` and
// `ArrowRight` held for `HOLD` (`30`) frames, one at a time. Every faculty
// stays held, nothing is alive, and the key is a real key event through
// Chromium's own input pipeline, the only road the keyboard has.
//
// TOLERANCE. `FLOAT_TOL` on the reported speed, an exact product, and
// `POSITION_TOL` (`1e-6`) on each per-tick step, the case's allowance for a
// position integrated over ticks. The unscaled `3` is six tenths of a unit from
// every step.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL, TICK_DT, moveSpeedOf } from "../constants";
import {
  captureReplay,
  createHarness,
  holdKeysWatching,
  holdPassive,
  isolate,
  tickSteps,
  type Harness,
} from "../harness";

/** The Bellows level held: `speedMul` `1.2`. */
const BELLOWS_LEVEL = 2;

/** Half a second of the hold, read one tick at a time. */
const HOLD = 30;

/** `180 × (1 + 0.1 × 2)`. */
const EXPECTED_SPEED = moveSpeedOf({ bellows: BELLOWS_LEVEL });

/** `216 / 60`. */
const EXPECTED_STEP = EXPECTED_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads moveSpeed 216 with Bellows 2 held and moves 3.6 units on every tick of a held ArrowRight", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "bellows", BELLOWS_LEVEL);
  const posed = await h.snapshot();
  assertNear(
    posed.run.moveSpeed,
    EXPECTED_SPEED,
    FLOAT_TOL,
    "the moveSpeed reported with Bellows 2 held",
  );

  const ticks = await captureReplay(h, "speed", () =>
    holdKeysWatching(h, ["ArrowRight"], HOLD),
  );

  assertEqual(ticks.length, HOLD, "the frames the hold ran");
  tickSteps(opened, ticks).forEach((step, i) => {
    assertNear(
      step.x,
      EXPECTED_STEP,
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
});
