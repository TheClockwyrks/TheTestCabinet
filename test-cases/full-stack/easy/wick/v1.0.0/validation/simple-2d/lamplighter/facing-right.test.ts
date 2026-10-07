// lamplighter/facing-right — moving right faces the lamplighter right.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "On any tick whose
// movement direction has a non-zero horizontal component, facing becomes the
// direction of that component: "left" when it is negative and "right" when it
// is positive." specs/world.md ("One tick") runs movement and facing in phase 2
// of every tick, and specs/controls.md reads `right` as a held value "sampled
// once per frame and applied to every tick that frame consumes", so the first
// tick under a held ArrowRight has the direction (1, 0) and leaves facing
// "right".
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. A fresh run already faces right, so
// `facing` is posed to "left" through the surface and read back: what this
// point reads is the turn back, and a surface that does not answer that pose
// fails the point here.
//
// WHAT IS READ, AND IN WHICH DIRECTION. `facing` after exactly one tick of
// ArrowRight held, the tick the rule names. The other side of the rule is
// `facing-left`. The frame that ran that tick is kept as the still.
//
// TOLERANCE. None: `facing` is one of two strings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The first key specs/controls.md binds to `right`: ArrowRight. */
const KEY = BINDINGS.right[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns facing right on the first tick ArrowRight is held", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is held on");
  h.debug.setFacing("left");
  assertEqual(
    h.snapshot().run.player.facing,
    "left",
    "facing as posed before the key, read back through the surface",
  );

  h.holdKey(KEY);
  let after;
  try {
    after = await h.tick(1);
  } finally {
    h.releaseKey(KEY);
  }
  captureStill(h, "right");

  assertEqual(
    after.run.player.facing,
    "right",
    `facing after one tick of ${KEY}`,
  );
});
