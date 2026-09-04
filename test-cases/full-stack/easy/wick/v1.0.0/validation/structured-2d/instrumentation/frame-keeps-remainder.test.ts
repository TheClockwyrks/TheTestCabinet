// Wick — instrumentation/frame-keeps-remainder: on `playing`, the part of a
// frame short of a whole tick waits in `accumulator`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "A
// deterministic core": "each frame's delta time joins the accumulator, every
// whole `TICK_DT` in it is consumed as a tick, and the remainder waits for the
// next frame"; "a clock of any other length poses a partial frame". How many
// ticks the frame consumed is
// `instrumentation/frame-consumes-whole-ticks`'s.
//
// THE DRIVE. An isolated run and one frame of 40 ms through the scripted clock
// (`frameOf`): `0.04 − 2/60 = 0.00666…` waiting. `REAL_EPS` on the remainder,
// a difference of stated reals.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
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

it("keeps the remainder of a 40 ms frame in the accumulator", async () => {
  isolate(h);
  const after = await h.frameOf(FRAME_MS);
  captureStill(h, "remainder");

  assertNear(
    after.accumulator,
    EXPECTED_REMAINDER,
    REAL_EPS,
    "accumulator after one 40 ms frame",
  );
});
