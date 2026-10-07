// instrumentation/set-next-drop-consumed — the kill that takes a posed drop
// consumes it, so `nextDrop` reads `null` afterwards.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes"):
// each value "is `null` on the idle run and after the draw that consumed it";
// `setNextDrop`: "that kill consumes it".
//
// THE POSE. As `set-next-drop`: an isolated night with `drops` alone and one
// real kill.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
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

it("reads null once the kill has taken the posed drop", async () => {
  isolate(h);
  enable(h, "drops");
  h.debug.setNextDrop("bread");
  assertEqual(h.snapshot().run.nextDrop, "bread", "nextDrop before the kill");

  const kill = await killOne(h, "moth", KILL_DX, 0);
  captureStill(h, "consumed");

  assertLength(kill.pickups, 1, "the pickups the kill dropped");
  assertNull(kill.after.run.nextDrop, "nextDrop after the kill");
});
