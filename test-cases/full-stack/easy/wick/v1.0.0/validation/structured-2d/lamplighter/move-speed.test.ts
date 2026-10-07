// lamplighter/move-speed — the lamplighter moves at MOVE_SPEED.
//
// WHAT THIS DECIDES. The size of the step: under a held `ArrowRight` with no
// Bellows held, one second of game time moves the lamplighter exactly 180
// units, 3 units on every tick. The direction is `move-right`'s point.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The lamplighter") fixes
// `MOVE_SPEED` at `180` units per second and ("Movement") states: "The
// velocity is that direction times `moveSpeed`, and each tick the position
// advances by the velocity times `TICK_DT`", with "`moveSpeed` is
// `MOVE_SPEED` times the speed multiplier `specs/passives.md` defines, so
// with no Bellows held it is `MOVE_SPEED`". `TICK_DT` is `1 / 60`
// (specs/world.md, "The plane"), so a tick is `180 / 60 = 3` units and sixty
// ticks are `180`.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, no passive held (so no Bellows), every driver switch off,
// so nothing but the held key moves the lamplighter and nothing changes its
// speed mid-hold.
//
// THE TOLERANCE. `MOTION_EPS` on every step and on the second's total: the
// suite's integration bound, orders above the rounding of sixty additions of
// `3` and far below one step of the wrong size.

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

/** The step of one tick with no Bellows held: 3 units. */
const STEP = MOVE_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves 3 units on every tick and 180 units over a held second", async () => {
  isolate(h);
  const start = h.snapshot().run.player;

  const trace = await captureReplay(h, "second", () =>
    holdSampling(h, ["ArrowRight"], HELD_TICKS),
  );

  let previous = start;
  trace.forEach((s, i) => {
    assertNear(
      s.run.player.x - previous.x,
      STEP,
      MOTION_EPS,
      `the step in player.x on tick ${i + 1} of the hold`,
    );
    previous = s.run.player;
  });
  assertNear(
    trace[trace.length - 1].run.player.x - start.x,
    MOVE_SPEED,
    MOTION_EPS,
    "player.x moved over one held second",
  );
});
