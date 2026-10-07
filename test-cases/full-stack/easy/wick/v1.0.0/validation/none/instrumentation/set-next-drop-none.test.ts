// Wick — instrumentation/set-next-drop-none: with `setNextDrop("none")` the
// next common kill drops its gem and no pickup, in place of its roll.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextDrop(kind)`): "drops that pickup beside its gem, or
// nothing for `none`, in place of its roll". specs/world.md ("Gems"): the gem
// is dropped whatever the roll.
//
// WHY THE WORLD IS POSED AS IT IS. As `set-next-drop`: an isolated night with
// `drops` alone and a real kill far outside every collection distance.

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

it("drops the gem and no pickup when none is posed", async () => {
  await isolate(h, { on: ["drops"] });
  await h.debug.setNextDrop("none");
  assertEqual(
    (await h.snapshot()).run.nextDrop,
    "none",
    "nextDrop after the pose",
  );

  const kill = await killCommon(h, "moth", killPoint(0));
  await captureStill(h, "gem");

  assertLength(kill.gems, 1, "the gems the kill dropped");
  assertLength(kill.pickups, 0, "the pickups the kill dropped under none");
});
