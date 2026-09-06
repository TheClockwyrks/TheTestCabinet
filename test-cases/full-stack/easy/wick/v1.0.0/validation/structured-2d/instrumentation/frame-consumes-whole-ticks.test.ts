// Wick — instrumentation/frame-consumes-whole-ticks: on `playing`, one frame
// worth 0.04 s consumes exactly 2 ticks.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "A
// render-free core": "each frame's delta time joins the accumulator, every
// whole `TICK_DT` in it is consumed as a tick, and the remainder waits for the
// next frame"; "a clock of any other length poses a partial frame".
//
// THE DRIVE. An isolated run and one frame of 40 ms through the scripted clock
// (`frameOf`): two ticks. What the frame leaves waiting is
// `instrumentation/frame-keeps-remainder`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const FRAME_MS = 40;
const EXPECTED_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("consumes two ticks from a 40 ms frame", async () => {
  const before = isolate(h);
  const after = await h.frameOf(FRAME_MS);
  captureStill(h, "partial");

  assertEqual(
    after.run.tick - before.run.tick,
    EXPECTED_TICKS,
    "ticks consumed by one 40 ms frame",
  );
});
