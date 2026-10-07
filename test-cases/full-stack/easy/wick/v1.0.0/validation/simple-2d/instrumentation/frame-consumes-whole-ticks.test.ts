// instrumentation/frame-consumes-whole-ticks — on playing, one frame worth
// 0.04 s consumes exactly 2 ticks.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "A render-free
// core": "each frame's delta time joins the accumulator, every whole `TICK_DT`
// in it is consumed as a tick, and the remainder waits for the next frame",
// and "a clock of any other length poses a partial frame". 0.04 holds two
// whole sixtieths (0.0333…) with a remainder left over; what happens to the
// remainder is `instrumentation/frame-keeps-remainder`'s.
//
// THE READ. `frameOf(0.04)` swaps a 40 ms ConstantClock in for one frame on
// an isolated run, and the tick count rose by exactly two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("consumes two ticks from a 40 ms frame", async () => {
  const posed = isolate(h);

  const after = await h.frameOf(FRAME_SECONDS);
  captureStill(h, "partial");

  assertEqual(
    after.run.tick - posed.run.tick,
    WHOLE_TICKS,
    "ticks the frame consumed",
  );
});
