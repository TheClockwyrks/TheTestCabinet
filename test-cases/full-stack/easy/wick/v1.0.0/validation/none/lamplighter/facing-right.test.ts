// lamplighter/facing-right — a tick that moves a left-facing lamplighter right
// turns its facing right.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "On any tick
// whose movement direction has a non-zero horizontal component, `facing`
// becomes the direction of that component: `"left"` when it is negative and
// `"right"` when it is positive." specs/controls.md binds `right` to
// `ArrowRight`, "held on `playing`", and specs/world.md ("One tick") runs the
// movement and the facing update together in phase 2, so the ONE tick a hold
// of ArrowRight runs is a tick whose direction is `(1, 0)`, and `facing` is
// `"right"` in that tick's snapshot. The figure is a string the specification
// fixes exactly, so there is no tolerance to state.
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone at the origin,
// every driver switch off, nothing alive. `facing` is posed to `"left"` through
// the surface (specs/instrumentation.md: "`setFacing(facing)` Sets `facing` to
// `facing`, `"left"` or `"right"`"), because a fresh run faces right already
// and a check that read `"right"` after the tick would have decided nothing.
// The key is a real key event, down before the frame runs and up after it.
//
// THE PICTURE. The still is the frame the tick rendered: the lamplighter drawn
// "facing the way `facing` says" (specs/ui.md). The verdict is read from the
// snapshot.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdKeys,
  isolate,
  player,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns facing right on a tick ArrowRight is held while facing left", async () => {
  await isolate(h);
  await h.debug.setFacing("left");
  const posed = await h.snapshot();
  assertEqual(player(posed).facing, "left", "facing as posed before the tick");

  const turned = await holdKeys(h, ["ArrowRight"], 1);
  await captureStill(h, "right");

  assertEqual(turned.screen, "playing", "the screen the tick ran on");
  assertEqual(
    player(turned).facing,
    "right",
    "facing after one tick of ArrowRight held",
  );
});
