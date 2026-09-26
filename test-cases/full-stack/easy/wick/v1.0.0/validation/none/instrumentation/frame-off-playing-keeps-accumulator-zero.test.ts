// Wick — instrumentation/frame-off-playing-keeps-accumulator-zero: on
// `paused`, one frame worth `0.04` s ticks nothing, leaves the accumulator at
// `0`, and raises `simTime` by `0.04`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `advance(seconds)`):
// "On any other screen the frame ticks nothing and the accumulator stays `0`";
// "the keys are read, `simTime` rises by `seconds`". And "A render-free core":
// "On every other screen a frame ticks nothing and the accumulator holds `0`."
// The accumulator reading is exact, since nothing may join it; `simTime` is
// read to `TIMER_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. `paused` is the screen a run stands on with
// its clock stopped, reached by the `setScreen` row that "Exactly as `pause`
// does" enters it; a frame longer than a tick is posed so a build that let the
// delta through would show whole ticks, not a rounding. The frame is bracketed
// inside the page, because the same document leaves the build's own loop
// running in real time while the clock is held and has `simTime` rise by the
// delta of every frame it runs, so a reading taken across two crossings would
// count those frames too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { TIMER_TOL } from "../constants";
import {
  bracket,
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  type Harness,
} from "../harness";

const FRAME_SECONDS = 0.04;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ticks nothing on paused and leaves the accumulator at 0", async () => {
  await isolate(h);
  const paused = await poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the frame runs on");

  const { before, after } = await bracket(h, "advance", [FRAME_SECONDS]);
  await captureStill(h, "paused");

  assertEqual(after.screen, "paused", "the screen after the frame");
  assertEqual(
    after.run.tick,
    before.run.tick,
    "the run clock after a paused frame",
  );
  assertEqual(after.accumulator, 0, "the accumulator after a paused frame");
  assertNear(
    after.simTime - before.simTime,
    FRAME_SECONDS,
    TIMER_TOL,
    "simTime the frame added",
  );
});
