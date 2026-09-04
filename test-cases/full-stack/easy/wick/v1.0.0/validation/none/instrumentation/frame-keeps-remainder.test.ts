// Wick — instrumentation/frame-keeps-remainder: on `playing`, the part of a
// frame that is short of a whole tick waits in `accumulator`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "A deterministic
// core" and `advance(seconds)`): "each frame's delta time joins the
// accumulator, every whole `TICK_DT` in it is consumed as a tick, and the
// remainder waits for the next frame"; "on `playing` the delta joins the
// accumulator and every whole `TICK_DT` in it is consumed as a tick, the
// remainder waiting in `accumulator`". `0.04 / (1/60)` is `2.4`, so the
// remainder is `0.04 − 2/60`, read to `TIMER_TOL`. How many ticks the frame
// consumed is `instrumentation/frame-consumes-whole-ticks`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, so neither tick can leave
// `playing` and discard the remainder; the accumulator is `0` at the start of
// the frame, so the remainder read is the frame's own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { TICK_DT, TIMER_TOL } from "../constants";
import {
  advanceBy,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The frame's delta: `2.4` ticks' worth. */
const FRAME_SECONDS = 0.04;
const WHOLE_TICKS = Math.floor(FRAME_SECONDS / TICK_DT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the part of the frame short of a tick in the accumulator", async () => {
  const before = await isolate(h);
  assertEqual(before.accumulator, 0, "the accumulator before the frame");

  const after = await advanceBy(h, FRAME_SECONDS);
  await captureStill(h, "remainder");

  assertNear(
    after.accumulator,
    FRAME_SECONDS - WHOLE_TICKS * TICK_DT,
    TIMER_TOL,
    "the remainder left waiting",
  );
});
