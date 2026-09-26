// instrumentation/set-screen-paused — `setScreen('paused')` on playing enters
// paused with menuIndex 0, the run untouched and the accumulator 0, exactly as
// `pause` does.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `paused`: from `playing`, "Exactly as `pause` does; the accumulator is
// discarded as on any frame that leaves `playing`". specs/ui.md, "What
// advances on each screen": "The delta time left unconsumed is discarded on
// any frame or pose that leaves `playing` ... so the accumulator is `0` on
// every screen but `playing` by every route".
//
// THE POSE. The busy night, ticked once, then a 25 ms frame that leaves a
// remainder in the accumulator, so the pose has something to discard. Then
// the pose: the screen, the menu index, the accumulator, and `run` field for
// field against the reading before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseBusyNight } from "./helpers";

/** A frame of 25 ms on playing: one tick and a remainder in the accumulator. */
const PARTIAL_FRAME_SECONDS = 0.025;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pauses with the run untouched and the accumulator discarded", async () => {
  poseBusyNight(h);
  await h.tick(1);
  const before = await h.frameOf(PARTIAL_FRAME_SECONDS);
  assertGreaterThan(before.accumulator, 0, "the accumulator before the pose");

  h.debug.setScreen("paused");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "paused");

  assertEqual(s.screen, "paused", "the screen after the pose");
  assertEqual(s.menuIndex, 0, "menuIndex on pausing");
  assertEqual(s.accumulator, 0, "the accumulator on paused");
  assertDeepEqual(s.run, before.run, "run across the pause");
});
