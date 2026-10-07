// instrumentation/set-next-drop-none — with `setNextDrop("none")` the next
// common kill drops its gem and no pickup, in place of its roll.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `setNextDrop(kind)`): "drops that pickup beside its gem, or nothing for
// `none`, in place of its roll". specs/world.md ("Gems"): the gem is dropped
// whatever the roll.
//
// THE POSE. As `set-next-drop`: an isolated night with `drops` alone and a
// real kill far outside every collection distance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { killOne } from "../pickups/sample";

const KILL_DX = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the gem and no pickup when none is posed", async () => {
  isolate(h);
  enable(h, "drops");
  h.debug.setNextDrop("none");
  assertEqual(h.snapshot().run.nextDrop, "none", "nextDrop after the pose");

  const kill = await killOne(h, "moth", KILL_DX, 0);
  captureStill(h, "gem");

  assertLength(kill.gems, 1, "the gems the kill dropped");
  assertLength(kill.pickups, 0, "the pickups the kill dropped under none");
});
