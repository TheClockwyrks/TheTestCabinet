// lamplighter/diagonal-equals-cardinal — the diagonal is as fast as a cardinal.
//
// WHAT THIS DECIDES. That two perpendicular actions held together move the
// lamplighter along the NORMALIZED diagonal: 180 units per second along it,
// which is `3 × (0.7071, 0.7071)` units per tick, and not `(3, 3)`.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The movement
// direction is the sum of the unit vectors of the held actions, ... `down`
// `(0, 1)`, ... and `right` `(1, 0)`, normalized to unit length when the sum
// is non-zero. The velocity is that direction times `moveSpeed`, and each
// tick the position advances by the velocity times `TICK_DT`. Diagonal
// movement is therefore exactly as fast as cardinal movement". With
// `MOVE_SPEED` `180`, `TICK_DT` `1 / 60`, and no Bellows held, the tick's
// step is `3` units along `(1, 1) / √2`: `3 / √2` on each axis.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, no passive held, every driver switch off, so nothing but
// the two held keys moves the lamplighter. Both keys are dispatched before
// the first frame, so every sampled tick is a diagonal tick.
//
// THE TOLERANCE. `MOTION_EPS` on each axis of every step and of the second's
// total: the suite's integration bound, far below the `0.88` units a tick of
// `(3, 3)` would overshoot each axis by.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { MOTION_EPS, MOVE_SPEED, TICK_DT, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  holdSampling,
  isolate,
  type Harness,
} from "../harness";

/** One second of game time. */
const HELD_TICKS = TICK_HZ;

/** Each axis's share of one tick's 3-unit step along the normalized diagonal. */
const AXIS_STEP = MOVE_SPEED * TICK_DT * Math.SQRT1_2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves 3 / √2 units on each axis per tick with ArrowRight and ArrowDown held", async () => {
  isolate(h);
  const start = h.snapshot().run.player;

  const trace = await captureReplay(h, "diagonal", () =>
    holdSampling(h, ["ArrowRight", "ArrowDown"], HELD_TICKS),
  );

  let previous = start;
  trace.forEach((s, i) => {
    const tick = i + 1;
    assertNear(
      s.run.player.x - previous.x,
      AXIS_STEP,
      MOTION_EPS,
      `the step in player.x on tick ${tick} of the diagonal hold`,
    );
    assertNear(
      s.run.player.y - previous.y,
      AXIS_STEP,
      MOTION_EPS,
      `the step in player.y on tick ${tick} of the diagonal hold`,
    );
    previous = s.run.player;
  });
  const last = trace[trace.length - 1].run.player;
  assertNear(
    Math.hypot(last.x - start.x, last.y - start.y),
    MOVE_SPEED,
    MOTION_EPS,
    "the distance moved along the diagonal over one held second",
  );
});
