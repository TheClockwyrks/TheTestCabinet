// instrumentation/frame-consumes-whole-ticks — on playing, one frame worth
// 0.04 s consumes exactly 2 ticks and leaves the accumulator at
// 0.04 − 2 × TICK_DT.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "A deterministic
// core": "each frame's delta time joins the accumulator, every whole `TICK_DT`
// in it is consumed as a tick, and the remainder waits for the next frame",
// and "a clock of any other length poses a partial frame". 0.04 holds two
// whole sixtieths (0.0333…) with 0.00666… left over.
//
// THE READ. `frameOf(0.04)` swaps a 40 ms ConstantClock in for one frame on
// an isolated run. The tick count rose by exactly two; the accumulator is the
// remainder within FIGURE_TOLERANCE, the difference of two decimal figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const FRAME_SECONDS = 0.04;
const WHOLE_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("consumes two ticks from a 40 ms frame and keeps the remainder", async () => {
  const posed = isolate(h);

  const after = await h.frameOf(FRAME_SECONDS);
  captureStill(h, "partial");

  assertEqual(
    after.run.tick - posed.run.tick,
    WHOLE_TICKS,
    "ticks the frame consumed",
  );
  assertWithin(
    after.accumulator,
    FRAME_SECONDS - WHOLE_TICKS * TICK_DT,
    FIGURE_TOLERANCE,
    "the accumulator: the frame's remainder",
  );
});
