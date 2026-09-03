// instrumentation/set-screen-playing-resumes — `setScreen('playing')` on
// paused returns to playing with the run untouched, exactly as `pause` on
// paused does.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `playing` from `paused`: "Resumes exactly as `pause` on `paused` does;
// the run is untouched". specs/ui.md: on `levelup`, `chest`, `paused`,
// "Nothing" advances and "The world beneath holds exactly the tick it was at".
//
// THE POSE. The busy night, ticked once so the aura is placed and the shard's
// hit is on record, paused through the surface, then resumed through it. The
// whole of `run` is compared field for field against the reading on paused,
// and the screen and menuIndex are read.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseBusyNight } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to playing with the run exactly as the pause left it", async () => {
  poseBusyNight(h);
  await h.tick(1);
  h.debug.setScreen("paused");
  const paused = await h.tick(2);
  assertEqual(paused.screen, "paused", "the screen before the pose");

  h.debug.setScreen("playing");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "resumed");

  assertEqual(s.screen, "playing", "the screen after the pose");
  assertEqual(s.menuIndex, 0, "menuIndex on resuming");
  assertDeepEqual(s.run, paused.run, "run across the resume");
});
