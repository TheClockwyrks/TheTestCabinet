// lamplighter/facing-holds-on-vertical — facing holds through vertical movement.
//
// WHAT THIS DECIDES. That a tick moving straight up leaves `facing` as it
// was: posed `"left"`, it stays `"left"` on every tick of a held `ArrowUp`.
// Holding at rest is a point of its own.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "A tick with no
// horizontal component, whether the lamplighter is still or moving straight
// up or down, leaves `facing` as it was." specs/world.md ("Movement") gives
// `up` the unit vector `(0, -1)`, whose horizontal component is `0`, and
// specs/controls.md binds it to `ArrowUp`, held on `playing`. `"left"` is
// the value a fresh run does not start with, so a build that reset facing to
// right on any moving tick is caught.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, every driver switch off, so nothing but the held key moves
// the lamplighter. `facing` is posed `"left"` through `setFacing`, `ArrowUp`
// is held for 60 ticks, and `facing` is read after every tick. That `y` falls
// is read beside it, so the reading is of a lamplighter that MOVED straight
// up rather than one that stood still.
//
// THE TOLERANCE. None on `facing`, one of two strings compared exactly; the
// fall in `y` is asserted strictly, tick over tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  holdSampling,
  isolate,
  type Harness,
} from "../harness";

/** A second of the hold, sampled after every tick. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps facing left on every tick ArrowUp alone is held", async () => {
  isolate(h);
  h.debug.setFacing("left");
  const start = h.snapshot().run.player;
  assertEqual(start.facing, "left", "facing as posed");

  const trace = await captureReplay(h, "vertical", () =>
    holdSampling(h, ["ArrowUp"], HELD_TICKS),
  );

  let previous = start;
  trace.forEach((s, i) => {
    const tick = i + 1;
    assertLessThan(
      s.run.player.y,
      previous.y,
      `player.y after tick ${tick} of the ArrowUp hold, against the tick before`,
    );
    assertEqual(
      s.run.player.facing,
      "left",
      `facing after tick ${tick} of the ArrowUp hold`,
    );
    previous = s.run.player;
  });
});
