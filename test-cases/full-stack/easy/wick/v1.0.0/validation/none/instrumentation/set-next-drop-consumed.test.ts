// Wick — instrumentation/set-next-drop-consumed: the kill that takes a posed
// drop consumes it, so `nextDrop` reads `null` afterwards.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes"): each value "is `null` on the idle run and after the draw that
// consumed it"; `setNextDrop`: "that kill consumes it".
//
// WHY THE WORLD IS POSED AS IT IS. As `set-next-drop`: an isolated night with
// `drops` alone and one real kill.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { killCommon, killPoint } from "../pickups/stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads null once the kill has taken the posed drop", async () => {
  await isolate(h, { on: ["drops"] });
  await h.debug.setNextDrop("bread");
  assertEqual(
    (await h.snapshot()).run.nextDrop,
    "bread",
    "nextDrop before the kill",
  );

  const kill = await killCommon(h, "moth", killPoint(0));
  await captureStill(h, "consumed");

  assertLength(kill.pickups, 1, "the pickups the kill dropped");
  assertNull(kill.after.run.nextDrop, "nextDrop after the kill");
});
