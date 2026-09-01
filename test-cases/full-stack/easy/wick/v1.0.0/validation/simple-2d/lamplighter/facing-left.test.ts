// lamplighter/facing-left — moving left faces the lamplighter left.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "facing is "left"
// or "right" and starts as "right". On any tick whose movement direction has a
// non-zero horizontal component, facing becomes the direction of that
// component: "left" when it is negative and "right" when it is positive."
// specs/world.md ("One tick") runs movement and facing in phase 2 of every
// tick, and specs/controls.md reads `left` as a held value "sampled once per
// frame and applied to every tick that frame consumes", so the first tick under
// a held ArrowLeft has the direction (-1, 0) and leaves facing "left".
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. `facing` is posed to "right" through
// the surface and read back, so the turn this point reads is a turn and not
// the value a fresh run happened to start with; a surface that does not answer
// that pose fails the point here.
//
// WHAT IS READ, AND IN WHICH DIRECTION. `facing` after exactly one tick of
// ArrowLeft held, the tick the rule names. The other side of the rule is
// `facing-right`, and the two cases that leave facing alone are
// `facing-holds-when-still` and `facing-holds-on-vertical`. The frame that ran
// that tick is kept as the still.
//
// TOLERANCE. None: `facing` is one of two strings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The first key specs/controls.md binds to `left`: ArrowLeft. */
const KEY = BINDINGS.left[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns facing left on the first tick ArrowLeft is held", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is held on");
  h.debug.setFacing("right");
  assertEqual(
    h.snapshot().run.player.facing,
    "right",
    "facing as posed before the key, read back through the surface",
  );

  h.holdKey(KEY);
  let after;
  try {
    after = await h.tick(1);
  } finally {
    h.releaseKey(KEY);
  }
  captureStill(h, "left");

  assertEqual(
    after.run.player.facing,
    "left",
    `facing after one tick of ${KEY}`,
  );
});
