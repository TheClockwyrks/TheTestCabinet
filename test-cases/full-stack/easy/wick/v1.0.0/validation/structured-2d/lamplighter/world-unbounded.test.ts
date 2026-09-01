// lamplighter/world-unbounded — no edge stops the lamplighter.
//
// WHAT THIS DECIDES. That movement far from the origin is the movement at the
// origin: posed at `(5000, -5000)`, a held `ArrowRight` moves the lamplighter
// 3 units on every tick, and nothing clamps it.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The plane"): "The world is
// an unbounded plane ... nothing bounds how far from it the lamplighter may
// walk", and ("Movement"): "The world is unbounded, so no edge stops the
// lamplighter." The step is the same rule as everywhere: `moveSpeed ×
// TICK_DT` along `right` `(1, 0)`, `180 / 60 = 3` units with no Bellows
// held. `(5000, -5000)` is several stages beyond any edge a build might have
// drawn the world with, and well inside the exactness of a double.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, no passive held, every driver switch off; the lamplighter
// is put at `(5000, -5000)` with `setPlayerPosition`, which moves nothing
// else, and `ArrowRight` is held for half a second, sampled every tick.
//
// THE TOLERANCE. `MOTION_EPS` on each step and on the held axis: the suite's
// integration bound, orders above the rounding of additions at a magnitude
// of five thousand and far below a step of the wrong size or a clamp.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { MOTION_EPS, MOVE_SPEED, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  holdSampling,
  isolate,
  type Harness,
} from "../harness";

/** Where the lamplighter is posed: far from the origin on both axes. */
const FAR = { x: 5000, y: -5000 };

/** Half a second of the hold, sampled after every tick. */
const HELD_TICKS = 30;

/** The step of one tick with no Bellows held: 3 units. */
const STEP = MOVE_SPEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves 3 units per tick under a held ArrowRight from (5000, -5000)", async () => {
  isolate(h);
  h.debug.setPlayerPosition(FAR.x, FAR.y);
  const start = h.snapshot().run.player;
  assertNear(start.x, FAR.x, MOTION_EPS, "player.x as posed");
  assertNear(start.y, FAR.y, MOTION_EPS, "player.y as posed");

  const trace = await captureReplay(h, "far", () =>
    holdSampling(h, ["ArrowRight"], HELD_TICKS),
  );

  let previous = start;
  trace.forEach((s, i) => {
    const tick = i + 1;
    assertNear(
      s.run.player.x - previous.x,
      STEP,
      MOTION_EPS,
      `the step in player.x on tick ${tick} of the hold, far from the origin`,
    );
    assertNear(
      s.run.player.y,
      FAR.y,
      MOTION_EPS,
      `player.y after tick ${tick} of the hold`,
    );
    previous = s.run.player;
  });
});
