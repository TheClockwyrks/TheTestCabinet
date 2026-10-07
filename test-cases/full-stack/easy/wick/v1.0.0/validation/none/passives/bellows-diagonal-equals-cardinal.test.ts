// Wick — passives/bellows-diagonal-equals-cardinal: the diagonal step is the
// cardinal step at every Bellows level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Move speed"): "Diagonal
// speed equals cardinal speed at every Bellows level", over "The lamplighter's
// move speed is `MOVE_SPEED` (`180`) times `speedMul`" and
// "`speedMul = 1 + BELLOWS_SPEED_PER_LEVEL × bellows`" with
// `BELLOWS_SPEED_PER_LEVEL` (`0.1`). `specs/world.md` ("Movement"): "The
// movement direction is the sum of the unit vectors of the held actions ...
// normalized to unit length when the sum is non-zero. The velocity is that
// direction times `moveSpeed`, and each tick the position advances by the
// velocity times `TICK_DT`". So with `right` and `down` held at Bellows 2 the
// direction is `(1/√2, 1/√2)` and each tick moves the lamplighter
// `216 / 60 / √2` along each of `+x` and `+y`, a step whose length is the
// cardinal `3.6`.
//
// THE POSE. An isolated night with Bellows 2 held through `setPassive` and
// `ArrowRight` and `ArrowDown` held together for `HOLD` (`30`) frames, one at a
// time, both down before the first frame runs and both up only after the last.
// Every faculty stays held and nothing is alive.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on each component of each step and on the
// step's length, the case's allowance for a position integrated over ticks. A
// build that moved the scaled step along both axes covers `5.09` rather than
// `3.6`, and one that never scaled the diagonal covers `3`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { POSITION_TOL, TICK_DT, moveSpeedOf } from "../constants";
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

/** `216 / 60`: the cardinal step at Bellows 2. */
const STEP = moveSpeedOf({ bellows: BELLOWS_LEVEL }) * TICK_DT;

/** Each component of one tick's step along the normalized `(1, 1)` diagonal. */
const COMPONENT = STEP / Math.SQRT2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves 3.6 units along the diagonal on every tick ArrowRight and ArrowDown are held with Bellows 2", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "bellows", BELLOWS_LEVEL);

  const ticks = await captureReplay(h, "diagonal", () =>
    holdKeysWatching(h, ["ArrowRight", "ArrowDown"], HOLD),
  );

  assertEqual(ticks.length, HOLD, "the frames the hold ran");
  tickSteps(opened, ticks).forEach((step, i) => {
    assertNear(
      step.x,
      COMPONENT,
      POSITION_TOL,
      `the lamplighter's step along x on tick ${i + 1} of the diagonal hold`,
    );
    assertNear(
      step.y,
      COMPONENT,
      POSITION_TOL,
      `the lamplighter's step along y on tick ${i + 1} of the diagonal hold`,
    );
    assertNear(
      Math.hypot(step.x, step.y),
      STEP,
      POSITION_TOL,
      `the length of the lamplighter's step on tick ${i + 1} of the diagonal hold`,
    );
  });
});
