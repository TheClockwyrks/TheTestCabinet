// screens/almanac-no-music — no cue loops on the almanac.
//
// WHAT THIS DECIDES. One thing: the `music` loop runs on no frame of
// `almanac`. The screens it DOES run on are the audio category's points.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "The almanac holds the idle run, nothing advances
//   while it is open, and no cue loops on it."
//   specs/ui.md (Audio, The loops): "`title`, `howto`, and `almanac` carry no
//   music", and "Both loops are reconciled from the state on every frame".
//   specs/instrumentation.md (`setScreen`): the `almanac` row, entered "exactly
//   as confirming `THE ALMANAC` does: the idle run".
//
// THE DRIVE. The almanac through `setScreen("almanac")`, from a reset game with
// no run behind it, so a build with a broken title menu still reaches the
// screen this point is about and no run is left standing to carry a loop. Then
// `FRAMES` (60) frames, one at a time.
//
// THE TOLERANCE. None. The reading is a boolean, taken after each of sixty
// frames rather than once at the end, so a build that starts the loop anywhere
// in that second fails on the frame it started it. The specification states no
// length for the stretch, so the span is the tolerance: a second of frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertFalse } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

/** One second of frames at `TICK_HZ`, the stretch the loop is read across. */
const FRAMES = TICK_HZ;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("runs no music loop on any frame of the almanac", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frames are run on");

  await captureReplay(h, "silent", async () => {
    for (let frame = 1; frame <= FRAMES; frame += 1) {
      await h.tick(1);
      assertFalse(
        h.looping("music"),
        `music looping on frame ${frame} of the almanac`,
      );
    }
  });

  assertEqual(h.snapshot().screen, "almanac", "the screen across the frames");
});
