// Wick — clock/accumulator-carries-remainder: the remainder of a frame waits
// for the next.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/overview.md` ("Units, ticks, the world, and the camera"): "each
//     frame's delta time accumulates, whole ticks are consumed from the
//     accumulation, and a remainder shorter than a tick waits for the next
//     frame while the screen stays `playing`."
//   - `specs/state.md` (`WickState`): "`accumulator`: the frame time waiting
//     for the next whole tick, in seconds, at least `0` and below `TICK_DT`. It
//     grows on `playing` alone".
//   - `specs/instrumentation.md` ("A render-free core"): "A tick is consumed
//     while the accumulator is at least `TICK_DT − TICK_EPSILON`".
//
// THE DRIVE. An isolated run, every switch off, so nothing but the clock
// moves. One frame of 25 ms: a tick is consumed and `0.025 − TICK_DT`
// (0.008333…) waits. One frame of 10 ms: the wait and the new delta make
// 0.018333…, one tick is consumed from that, and `0.025 + 0.01 − 2 × TICK_DT`
// (0.001666…) is the new remainder. A build that discards a frame's remainder
// runs no tick on the second frame; a build that runs a tick per frame
// regardless of its length runs one and leaves nothing; both fail here.
//
// TOLERANCE. `REAL_EPS` on the accumulator: it is a sum and a difference of
// two or three stated reals, and binary floating point rounds each by ulps,
// far below a billionth. The tick counts are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The two frames, in milliseconds. */
const FIRST_FRAME_MS = 25;
const SECOND_FRAME_MS = 10;

/** What each frame leaves waiting, in seconds. */
const FIRST_REMAINDER = FIRST_FRAME_MS / 1000 - TICK_DT;
const SECOND_REMAINDER =
  FIRST_FRAME_MS / 1000 + SECOND_FRAME_MS / 1000 - 2 * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries a frame's remainder into the next frame's tick", async () => {
  const posed = isolate(h);
  const startTick = posed.run.tick;

  const first = await h.frameOf(FIRST_FRAME_MS);
  const second = await h.frameOf(SECOND_FRAME_MS);
  captureStill(h, "remainder");

  assertEqual(
    first.run.tick,
    startTick + 1,
    "run.tick after a frame of 0.025 s",
  );
  assertNear(
    first.accumulator,
    FIRST_REMAINDER,
    REAL_EPS,
    "accumulator after a frame of 0.025 s",
  );
  assertEqual(
    second.run.tick,
    startTick + 2,
    "run.tick after a following frame of 0.01 s",
  );
  assertNear(
    second.accumulator,
    SECOND_REMAINDER,
    REAL_EPS,
    "accumulator after the following frame of 0.01 s",
  );
});
