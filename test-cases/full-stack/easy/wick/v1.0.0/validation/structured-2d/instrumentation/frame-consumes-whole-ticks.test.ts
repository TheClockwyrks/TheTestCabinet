// Wick — instrumentation/frame-consumes-whole-ticks: on `playing`, one frame
// worth 0.04 s consumes exactly 2 ticks and leaves `0.04 − 2 × TICK_DT`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "A
// deterministic core": "each frame's delta time joins the accumulator, every
// whole `TICK_DT` in it is consumed as a tick, and the remainder waits for the
// next frame"; "a clock of any other length poses a partial frame".
//
// THE DRIVE. An isolated run and one frame of 40 ms through the scripted clock
// (`frameOf`): two ticks, and `0.04 − 2/60 = 0.00666…` waiting. `REAL_EPS` on
// the remainder, a difference of stated reals.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const FRAME_MS = 40;
const EXPECTED_TICKS = 2;
const EXPECTED_REMAINDER = FRAME_MS / 1000 - EXPECTED_TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("consumes two ticks from a 40 ms frame and keeps the remainder", async () => {
  const before = isolate(h);
  const after = await h.frameOf(FRAME_MS);
  captureStill(h, "partial");

  assertEqual(
    after.run.tick - before.run.tick,
    EXPECTED_TICKS,
    "ticks consumed by one 40 ms frame",
  );
  assertNear(
    after.accumulator,
    EXPECTED_REMAINDER,
    REAL_EPS,
    "accumulator after one 40 ms frame",
  );
});
