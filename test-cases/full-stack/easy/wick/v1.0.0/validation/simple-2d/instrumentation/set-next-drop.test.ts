// instrumentation/set-next-drop — `setNextDrop("draft")` on `playing` sets
// `nextDrop` to `draft`, the snapshot reads it back, and the next common kill
// drops a draft beside its gem in place of its roll.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `setNextDrop(kind)`): "The next common enemy killed by a weapon while
// `drops` is on drops that pickup beside its gem, or nothing for `none`, in
// place of its roll". A draft drops on its own once in two hundred kills, so a
// build that ignored the pose is told apart on one kill.
//
// THE POSE. An isolated night with `drops` alone turned back on and a real
// kill: a moth `KILL_DX` (500) units out, outside every collection distance,
// and a posed Ember bolt on its center.

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

it("poses the next kill's drop, and the kill drops it", async () => {
  isolate(h);
  enable(h, "drops");
  h.debug.setNextDrop("draft");
  assertEqual(h.snapshot().run.nextDrop, "draft", "nextDrop after the pose");

  const kill = await killOne(h, "moth", KILL_DX, 0);
  captureStill(h, "dropped");

  assertLength(kill.gems, 1, "the gems the kill dropped");
  assertLength(kill.pickups, 1, "the pickups the kill dropped");
  assertEqual(kill.pickups[0].kind, "draft", "the posed drop, beside the gem");
});
