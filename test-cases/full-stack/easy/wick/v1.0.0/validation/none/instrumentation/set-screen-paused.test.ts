// Wick — instrumentation/set-screen-paused: `setScreen("paused")` on `playing`
// enters `paused` with `menuIndex` `0`, the run untouched and `accumulator`
// `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `paused | playing` row: "Exactly as `pause` does; the accumulator is
// discarded as on any frame that leaves `playing`." specs/ui.md: "The delta
// time left unconsumed is discarded on any frame or pose that leaves
// `playing` ... so the accumulator is `0` on every screen but `playing` by
// every route."
//
// WHY THE WORLD IS POSED AS IT IS. The run holds one entity of every kind and
// a partial frame is posed first, so the accumulator holds a remainder the
// call must discard while leaving the run exactly as it was.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import {
  advanceBy,
  captureStill,
  createHarness,
  documentedRun,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pauses the run untouched and discards the accumulator", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", 200, 0);
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  await placePuddle(h, "oil-splash", 50, 50);
  await placeGem(h, "medium", -200, 0);
  await placePickup(h, "bread", 0, -200);
  const before = await advanceBy(h, 0.02);
  assertNotEqual(before.accumulator, 0, "a remainder waiting before the pause");

  const paused = await poseScreen(h, "paused");
  await captureStill(h, "paused");

  assertEqual(paused.screen, "paused", "the screen after setScreen('paused')");
  assertEqual(paused.menuIndex, 0, "menuIndex on entering paused");
  assertEqual(paused.accumulator, 0, "the accumulator on paused");
  assertDeepEqual(
    documentedRun(paused.run),
    documentedRun(before.run),
    "the run across the pause",
  );
});
