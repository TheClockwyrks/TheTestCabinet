// lamplighter/key-w-moves-like-arrow-up — KeyW does exactly what ArrowUp does.
//
// WHAT THIS DECIDES. The second binding of `up`: while `KeyW` is held on
// `playing`, `player.y` falls tick over tick by exactly the step a held
// `ArrowUp` produces. That `ArrowUp` moves the lamplighter at all is
// `move-up`'s point, and the size of the step is `move-speed`'s; this point
// is that the two keys are the same action.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("Actions and bindings")
// binds `up` to "`ArrowUp`, `KeyW`" and states: "The two keys bound to an
// action are interchangeable: `KeyW` does exactly what `ArrowUp` does wherever
// `up` is read." specs/world.md ("Movement") makes the step under a held
// action `moveSpeed × TICK_DT` along the action's unit vector on every tick.
// So the tick-by-tick displacement under `KeyW` equals the tick-by-tick
// displacement under `ArrowUp` from the same start, and `y` falls.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, every driver switch off, so nothing but a held key moves
// the lamplighter. `ArrowUp` is held first, sampled every tick, the
// lamplighter is put back where it started with `setPlayerPosition`, and
// `KeyW` is held for the same count from the same place; the two traces
// are compared step for step. The arrow's trace is read off the same build
// on purpose: the rule is that the two keys are ONE action, so the step the
// arrow produced is the step the letter must produce, whatever it is.
//
// THE TOLERANCE. `MOTION_EPS`, the suite's integration bound, for each step's
// equality and for the held axis; the direction of each step is asserted
// strictly, so two keys that both move nothing fail here as well as there.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertNear } from "../assert";
import { MOTION_EPS } from "../constants";
import {
  captureReplay,
  createHarness,
  holdSampling,
  isolate,
  type Harness,
} from "../harness";

/** Half a second of each hold, sampled after every tick. */
const HELD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lowers player.y under a held KeyW by the step ArrowUp gives", async () => {
  isolate(h);
  const start = h.snapshot().run.player;

  const arrow = await holdSampling(h, ["ArrowUp"], HELD_TICKS);
  h.debug.setPlayerPosition(start.x, start.y);
  const letter = await captureReplay(h, "w", () =>
    holdSampling(h, ["KeyW"], HELD_TICKS),
  );

  let previous = start;
  letter.forEach((s, i) => {
    const tick = i + 1;
    assertLessThan(
      s.run.player.y,
      previous.y,
      `player.y after tick ${tick} of the KeyW hold, against the tick before`,
    );
    assertNear(
      s.run.player.y,
      arrow[i].run.player.y,
      MOTION_EPS,
      `player.y after tick ${tick} of the KeyW hold, against ArrowUp at the same tick`,
    );
    assertNear(
      s.run.player.x,
      start.x,
      MOTION_EPS,
      `player.x after tick ${tick} of the KeyW hold`,
    );
    previous = s.run.player;
  });
});
