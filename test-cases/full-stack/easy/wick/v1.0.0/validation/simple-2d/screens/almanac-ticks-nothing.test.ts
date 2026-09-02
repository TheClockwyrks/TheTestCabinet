// screens/almanac-ticks-nothing — the almanac advances nothing.
//
// WHAT THIS DECIDES. One thing: frames run on `almanac` leave the run exactly
// as the screen found it, the clock at `0` and every stored field the idle
// run's. That the almanac REPORTS the idle run on arriving is the
// instrumentation category's point; this one is about what a second of frames
// on it does.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "The almanac holds the idle run, nothing advances
//   while it is open, and no cue loops on it."
//   specs/ui.md ("What advances on each screen"): "`title`, `howto`, `almanac`
//   | Nothing."
//   specs/state.md ("The idle run"): the table of stored fields this check
//   compares against, restated as `IDLE_RUN` in `constants.ts`.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which enters it
// "exactly as confirming `THE ALMANAC` does: the idle run"
// (specs/instrumentation.md), then `FRAMES` (60) frames one at a time. The
// clock is read after every frame rather than once at the end, so a build whose
// almanac ticks and then rewinds fails on the frame it ticked.
//
// THE TOLERANCE. None: a tick count and the idle run's stored fields are exact
// figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { IDLE_RUN, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  runFields,
  type Harness,
} from "../harness";

let h: Harness;

/** One second of frames at `TICK_HZ`, the stretch the run is held across. */
const FRAMES = TICK_HZ;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the idle run across a second of frames on the almanac", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frames are run on");

  for (let frame = 1; frame <= FRAMES; frame += 1) {
    const after = await h.tick(1);
    assertEqual(after.screen, "almanac", `the screen on frame ${frame}`);
    assertEqual(after.run.tick, 0, `the run clock on frame ${frame}`);
  }
  captureStill(h, "still");

  assertDeepEqual(
    runFields(h.snapshot().run),
    IDLE_RUN,
    "the run the almanac held, as specs/state.md's idle table fixes it",
  );
});
