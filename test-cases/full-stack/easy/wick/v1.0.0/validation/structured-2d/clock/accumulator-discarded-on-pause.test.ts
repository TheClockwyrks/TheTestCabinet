// Wick — clock/accumulator-discarded-on-pause: pausing discards the remainder.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/controls.md` ("Actions and bindings"): `pause` is bound to `KeyP`,
//     read as an edge, and "pauses on `playing`"; "a frame whose press leaves
//     `playing` ticks nothing and discards the accumulator."
//   - `specs/instrumentation.md` ("A deterministic core"): "so is the
//     remainder on any other frame or pose that leaves `playing`. On every
//     other screen a frame ticks nothing and the accumulator holds `0`."
//   - `specs/instrumentation.md` (`setScreen`, `playing` from `paused`):
//     "Resumes exactly as `pause` on `paused` does; the run is untouched."
//
// THE DRIVE. An isolated run, every switch off. One frame of 10 ms poses a
// remainder of 0.01 s with no tick consumed. Then `KeyP` is pressed with a
// real key event, and the frame that delivers the edge leaves `playing`:
// it ticks nothing and the accumulator is `0` on `paused`. The run is then
// resumed through the surface and given another frame of 10 ms: a build that
// kept the 0.01 s would now hold 0.02 s and consume a tick, where a build
// that discarded it holds 0.01 s and consumes none.
//
// TOLERANCE. None on the accumulator at `0`, which the specification states
// exactly. `REAL_EPS` on the resumed remainder, one stated real.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

/** The partial frame, in milliseconds: no tick, all remainder. */
const PARTIAL_MS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("discards the posed remainder when KeyP pauses, and resumes with none", async () => {
  const posed = isolate(h);
  const partial = await h.frameOf(PARTIAL_MS);
  assertEqual(
    partial.run.tick,
    posed.run.tick,
    "run.tick after the frame of 0.01 s that posed the remainder",
  );
  assertNear(
    partial.accumulator,
    PARTIAL_MS / 1000,
    REAL_EPS,
    "the remainder the frame of 0.01 s posed",
  );

  const paused = await tap(h, "KeyP");
  captureStill(h, "discarded");

  assertEqual(paused.screen, "paused", "the screen the KeyP press opened");
  assertEqual(paused.accumulator, 0, "accumulator on paused");
  assertEqual(
    paused.run.tick,
    posed.run.tick,
    "run.tick after the frame whose press paused",
  );

  poseScreen(h, "playing");
  const resumed = await h.frameOf(PARTIAL_MS);
  assertEqual(
    resumed.run.tick,
    posed.run.tick,
    "run.tick after a frame of 0.01 s on the resumed run",
  );
  assertNear(
    resumed.accumulator,
    PARTIAL_MS / 1000,
    REAL_EPS,
    "accumulator after a frame of 0.01 s on the resumed run",
  );
});
