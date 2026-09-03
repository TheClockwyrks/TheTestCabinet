// lamplighter/facing-left — moving left turns facing left.
//
// WHAT THIS DECIDES. That a tick whose movement direction has a negative
// horizontal component sets `facing` to `"left"`. Turning back right, and
// holding through stillness and through vertical movement, are points of
// their own.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "On any tick
// whose movement direction has a non-zero horizontal component, `facing`
// becomes the direction of that component: `"left"` when it is negative and
// `"right"` when it is positive." specs/world.md ("Movement") gives `left`
// the unit vector `(-1, 0)`, and specs/controls.md binds it to `ArrowLeft`,
// held on `playing`. So the first tick of a held `ArrowLeft` leaves
// `facing` `"left"`.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, every driver switch off. `facing` is posed `"right"`
// through `setFacing` rather than assumed from the fresh run, so the turn is
// what is read and not the start value; that a run STARTS facing right is
// `starts-at-origin-facing-right`'s point. One tick is run with the key held
// and the frame that ran it is kept as the still, so the picture shows the
// turned sprite.
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

it("turns facing left on the tick ArrowLeft is held", async () => {
  isolate(h);
  h.debug.setFacing("right");
  assertEqual(h.snapshot().run.player.facing, "right", "facing as posed");

  const [after] = await holdSampling(h, ["ArrowLeft"], 1);
  captureStill(h, "left");

  assertEqual(
    after.run.player.facing,
    "left",
    "facing after one held tick of ArrowLeft",
  );
});
