// lamplighter/facing-right — moving right turns facing right.
//
// WHAT THIS DECIDES. That, with `facing` `"left"`, a tick whose movement
// direction has a positive horizontal component sets `facing` to `"right"`.
// Turning left, and holding through stillness and through vertical movement,
// are points of their own.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "On any tick
// whose movement direction has a non-zero horizontal component, `facing`
// becomes the direction of that component: `"left"` when it is negative and
// `"right"` when it is positive." specs/world.md ("Movement") gives `right`
// the unit vector `(1, 0)`, and specs/controls.md binds it to `ArrowRight`,
// held on `playing`. So the first tick of a held `ArrowRight` leaves
// `facing` `"right"`.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, every driver switch off. `facing` is posed `"left"`
// through `setFacing`, since a fresh run already faces right and a build
// that never turned would pass a reading of the start value. One tick is run
// with the key held and the frame that ran it is kept as the still, so the
// picture shows the turned sprite.
//
// THE TOLERANCE. None: `facing` is one of two strings, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdSampling,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("turns facing right on the tick ArrowRight is held, from left", async () => {
  isolate(h);
  h.debug.setFacing("left");
  assertEqual(h.snapshot().run.player.facing, "left", "facing as posed");

  const [after] = await holdSampling(h, ["ArrowRight"], 1);
  captureStill(h, "right");

  assertEqual(
    after.run.player.facing,
    "right",
    "facing after one held tick of ArrowRight",
  );
});
