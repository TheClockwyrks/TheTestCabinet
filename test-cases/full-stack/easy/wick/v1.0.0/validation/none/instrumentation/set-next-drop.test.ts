// Wick — instrumentation/set-next-drop: `setNextDrop("draft")` on `playing`
// sets `nextDrop` to `draft`, the snapshot reads it back, and the next common
// kill drops a draft beside its gem in place of its roll.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextDrop(kind)`): "The next common enemy killed by a weapon
// while `drops` is on drops that pickup beside its gem, or nothing for
// `none`, in place of its roll". A draft drops on its own once in two hundred
// kills, so a build that ignored the pose is told apart on one kill.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `drops` alone
// turned back on and a real kill: a moth `500` units out, outside every
// collection distance, and a level-1 Ember bolt on its center.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { killCommon, killPoint } from "../pickups/stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the next kill's drop, and the kill drops it", async () => {
  await isolate(h, { on: ["drops"] });
  await h.debug.setNextDrop("draft");
  assertEqual(
    (await h.snapshot()).run.nextDrop,
    "draft",
    "nextDrop after the pose",
  );

  const kill = await killCommon(h, "moth", killPoint(0));
  await captureStill(h, "dropped");

  assertLength(kill.gems, 1, "the gems the kill dropped");
  assertLength(kill.pickups, 1, "the pickups the kill dropped");
  assertEqual(kill.pickups[0]!.kind, "draft", "the posed drop, beside the gem");
});
