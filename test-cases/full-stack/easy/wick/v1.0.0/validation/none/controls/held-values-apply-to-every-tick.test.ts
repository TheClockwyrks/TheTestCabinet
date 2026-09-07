// controls/held-values-apply-to-every-tick — a frame's held values apply to
// every tick it consumes.
//
// WHAT THIS DECIDES. One thing: the held movement a frame samples is applied to
// EVERY tick that frame consumes, not to its first alone. One frame worth
// `0.05` s with `ArrowRight` held consumes three ticks and moves the lamplighter
// `9` units, `3` on each.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Moving the lamplighter"): "On `playing`, the four
//   movement actions are read as held values, sampled once per frame and
//   applied to every tick that frame consumes."
//   specs/world.md ("Movement"): the direction is the unit sum of the held
//   actions, `right` `(1, 0)`, "The velocity is that direction times
//   `moveSpeed`, and each tick the position advances by the velocity times
//   `TICK_DT`", with `moveSpeed` `MOVE_SPEED` (`180`) while no Bellows is held,
//   so `MOVE_STEP` is `3` units a tick.
//   specs/instrumentation.md ("`advance(seconds)`"): "Runs one frame of the
//   build's loop worth `seconds` of delta time ... the keys are read ... and on
//   `playing` the delta joins the accumulator and every whole `TICK_DT` in it
//   is consumed as a tick"; and under "A render-free core", "A tick is
//   consumed while the accumulator is at least `TICK_DT − TICK_EPSILON`", so
//   `0.05` s is exactly three ticks.
//
// THE DRIVE. An isolated night at the origin with an accumulator of `0`, the key
// held by Chromium, and ONE `advance(0.05)` — the one operation that poses a
// frame of more than a tick. A build that applies the sampled values to the
// first tick alone lands at `3`; one that re-reads nothing and applies them to
// each lands at `9`. The key is released after the frame, so the release is
// read by no frame this point drives.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` units the harness allows a position
// integrated over ticks; three steps of an exact `3` land on `9` to floating-
// point noise, and the nearest wrong reading is `6` units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BINDINGS, MOVE_STEP, POSITION_TOL } from "../constants";
import {
  advanceBy,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The one frame's delta time: three ticks of `TICK_DT` exactly. */
const FRAME_SECONDS = 0.05;

/** The ticks that frame consumes. */
const FRAME_TICKS = 3;

/** The first key bound to `right`. */
const RIGHT_KEY = BINDINGS.right[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the lamplighter 9 units over one 0.05 s frame of ArrowRight", async () => {
  const posed = await isolate(h);
  assertEqual(posed.run.player.x, 0, "player.x before the frame");
  assertEqual(posed.accumulator, 0, "the accumulator before the frame");

  await h.hold(RIGHT_KEY);
  let after;
  try {
    after = await advanceBy(h, FRAME_SECONDS);
  } finally {
    await h.release(RIGHT_KEY);
  }
  await captureStill(h, "frame");

  assertNear(
    after.run.player.x,
    MOVE_STEP * FRAME_TICKS,
    POSITION_TOL,
    "player.x after one 0.05 s frame with ArrowRight held",
  );
});
