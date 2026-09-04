// instrumentation/frame-keeps-remainder — on playing, the part of a frame short
// of a whole tick waits in the accumulator.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "A deterministic
// core": "each frame's delta time joins the accumulator, every whole `TICK_DT`
// in it is consumed as a tick, and the remainder waits for the next frame",
// and "a clock of any other length poses a partial frame". 0.04 holds two
// whole sixtieths (0.0333…) with 0.00666… left over. How many ticks the frame
// consumed is `instrumentation/frame-consumes-whole-ticks`'s.
//
// THE READ. `frameOf(0.04)` swaps a 40 ms ConstantClock in for one frame on
// an isolated run. The accumulator is the remainder within FIGURE_TOLERANCE,
// the difference of two decimal figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
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

it("keeps the remainder of a 40 ms frame in the accumulator", async () => {
  isolate(h);

  const after = await h.frameOf(FRAME_SECONDS);
  captureStill(h, "remainder");

  assertWithin(
    after.accumulator,
    FRAME_SECONDS - WHOLE_TICKS * TICK_DT,
    FIGURE_TOLERANCE,
    "the accumulator: the frame's remainder",
  );
});
