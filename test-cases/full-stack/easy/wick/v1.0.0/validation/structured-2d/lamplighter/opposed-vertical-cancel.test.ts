// lamplighter/opposed-vertical-cancel — up and down held together cancel.
//
// WHAT THIS DECIDES. That `ArrowUp` and `ArrowDown` held together leave
// `player.y` exactly where it was, tick over tick. The horizontal pair is a
// point of its own.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The movement
// direction is the sum of the unit vectors of the held actions, `up`
// `(0, -1)`, `down` `(0, 1)`, ... normalized to unit length when the sum is
// non-zero", and "two opposite actions held together cancel to no movement on
// that axis." `(0, -1) + (0, 1)` is the zero vector, so the velocity is zero
// and `y` advances by nothing on every tick.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, every driver switch off, so nothing but the held keys can
// move the lamplighter. Both keys are dispatched before the first frame, so
// every sampled tick is a tick with both held.
//
// THE TOLERANCE. `MOTION_EPS`, the suite's integration bound: a conformant
// build adds exactly nothing, and a build that moved on either key alone
// would be a whole 3-unit step off by the first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { MOTION_EPS } from "../constants";
import {
  captureReplay,
  createHarness,
  holdSampling,
  isolate,
  type Harness,
} from "../harness";

/** Half a second of the hold, sampled after every tick. */
const HELD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds player.y on every tick ArrowUp and ArrowDown are held together", async () => {
  isolate(h);
  const start = h.snapshot().run.player;

  const trace = await captureReplay(h, "cancel", () =>
    holdSampling(h, ["ArrowUp", "ArrowDown"], HELD_TICKS),
  );

  trace.forEach((s, i) => {
    assertNear(
      s.run.player.y,
      start.y,
      MOTION_EPS,
      `player.y after tick ${i + 1} of the opposed hold`,
    );
  });
});
