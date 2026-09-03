// lamplighter/move-down — a held ArrowDown moves the lamplighter down.
//
// WHAT THIS DECIDES. One direction of one control: while `ArrowDown` is held
// on `playing`, `player.y` rises on every tick and `player.x` does not move.
// How FAR it moves per tick is `move-speed`'s point, and the other three
// directions and the second key of each action are points of their own.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The movement
// direction is the sum of the unit vectors of the held actions, ... `down`
// `(0, 1)`, ... The velocity is that direction times `moveSpeed`, and each
// tick the position advances by the velocity times `TICK_DT`." specs/world.md
// ("The plane"): "`y` increasing downward". specs/controls.md binds `down` to
// `ArrowDown` and reads it "held on `playing`", "sampled once per frame and
// applied to every tick that frame consumes". So on every tick of the hold
// `y` is higher than the tick before and `x` is exactly what it was.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, every driver switch off, so nothing spawns, nothing hits,
// nothing fires, and nothing but the held key can move the lamplighter. The
// key is dispatched at the engine's own listener, so what is read is the
// build's controller reading the engine's held value.
//
// THE TOLERANCE. The rise is asserted strictly, tick over tick, with no
// figure: this point is the direction alone. `x` is held to `MOTION_EPS`, the
// suite's integration bound, since the direction's horizontal component is
// exactly `0` and a conformant build adds exactly nothing to it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear } from "../assert";
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

it("raises player.y on every tick ArrowDown is held, x holding", async () => {
  isolate(h);
  const start = h.snapshot().run.player;

  const trace = await captureReplay(h, "down", () =>
    holdSampling(h, ["ArrowDown"], HELD_TICKS),
  );

  let previous = start;
  trace.forEach((s, i) => {
    const tick = i + 1;
    assertGreaterThan(
      s.run.player.y,
      previous.y,
      `player.y after tick ${tick} of the hold, against the tick before`,
    );
    assertNear(
      s.run.player.x,
      start.x,
      MOTION_EPS,
      `player.x after tick ${tick} of the hold`,
    );
    previous = s.run.player;
  });
});
