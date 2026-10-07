// instrumentation/frame-off-playing-keeps-accumulator-zero — on paused, one
// frame worth 0.04 s ticks nothing, leaves the accumulator at 0, and raises
// simTime by 0.04.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md: "On every other
// screen a frame ticks nothing and the accumulator holds `0`"; "`simTime`
// rises by every frame's delta time on every screen". specs/state.md,
// `accumulator`: "It grows on `playing` alone".
//
// THE READ. A run paused through the surface, then one 40 ms frame. Had the
// frame been on playing it would have consumed two ticks and kept a
// remainder; on paused the tick count holds, the accumulator reads 0 exactly,
// and simTime rose by the whole 0.04 within FIGURE_TOLERANCE.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

const FRAME_SECONDS = 0.04;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ticks nothing and holds the accumulator at 0 on paused", async () => {
  const paused = poseScene(h, "paused");

  const after = await h.frameOf(FRAME_SECONDS);
  captureStill(h, "paused");

  assertEqual(after.screen, "paused", "the screen after the frame");
  assertEqual(after.run.tick, paused.run.tick, "run.tick after a paused frame");
  assertEqual(after.accumulator, 0, "the accumulator on paused");
  assertWithin(
    after.simTime - paused.simTime,
    FRAME_SECONDS,
    FIGURE_TOLERANCE,
    "simTime raised by the frame's delta",
  );
});
