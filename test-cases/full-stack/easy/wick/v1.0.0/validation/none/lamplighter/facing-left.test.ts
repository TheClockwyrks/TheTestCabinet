// lamplighter/facing-left — a tick that moves the lamplighter left turns its
// facing left.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "`facing` is
// `"left"` or `"right"` and starts as `"right"`. On any tick whose movement
// direction has a non-zero horizontal component, `facing` becomes the
// direction of that component: `"left"` when it is negative and `"right"` when
// it is positive." specs/controls.md binds `left` to `ArrowLeft`, "held on
// `playing`", and specs/world.md ("One tick") runs the movement and the facing
// update together in phase 2, so the ONE tick a hold of ArrowLeft runs is a
// tick whose direction is `(-1, 0)`, and `facing` is `"left"` in that tick's
// snapshot. The figure is a string the specification fixes exactly, so there
// is no tolerance to state.
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone at the origin,
// every driver switch off, nothing alive. `facing` is posed to `"right"`
// through the surface rather than assumed from the fresh run, so the tick is a
// turn whatever the run opened facing; what a fresh run opens facing is
// `starts-at-origin-facing-right`'s point. The key is a real key event, down
// before the frame runs and up after it.
//
// THE PICTURE. The still is the frame the tick rendered: the lamplighter drawn
// "facing the way `facing` says" (specs/ui.md), which is what a reviewer sees.
// The verdict is read from the snapshot.

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

it("turns facing left on a tick ArrowLeft is held", async () => {
  await isolate(h);
  await h.debug.setFacing("right");
  const posed = await h.snapshot();
  assertEqual(player(posed).facing, "right", "facing as posed before the tick");

  const turned = await holdKeys(h, ["ArrowLeft"], 1);
  await captureStill(h, "left");

  assertEqual(turned.screen, "playing", "the screen the tick ran on");
  assertEqual(
    player(turned).facing,
    "left",
    "facing after one tick of ArrowLeft held",
  );
});
