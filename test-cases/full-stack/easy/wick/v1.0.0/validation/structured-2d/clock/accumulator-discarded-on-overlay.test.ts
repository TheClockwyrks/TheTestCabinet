// Wick — clock/accumulator-discarded-on-overlay: a tick that opens an overlay
// discards the remainder.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md` ("A render-free core"): "A tick that leaves
//     `playing`, by opening an overlay or ending the run, is the last tick its
//     frame runs, and the remainder is discarded ... On every other screen a
//     frame ticks nothing and the accumulator holds `0`."
//   - `specs/progression.md` ("The level-up overlay"): "A `playing` tick that
//     ends with `pendingLevelUps` above `0` runs to completion and then opens
//     the overlay: `screen` becomes `levelup`".
//   - `specs/instrumentation.md` (`setPendingLevelUps`): "A `playing` tick
//     that ends with it above `0` opens the overlay exactly as a gain does."
//
// THE DRIVE. An isolated run with one level-up posed pending, and one frame
// of 25 ms. The frame's first tick opens the overlay, so it is the frame's
// last tick: `run.tick` rises by one, `screen` is `levelup`, and the 8.33 ms
// the frame had left over is discarded rather than kept for the resume. A
// build that keeps the remainder shows it in the accumulator, where the
// specification says `0` stands on every screen but `playing`.
//
// TOLERANCE. None: `0` is what the specification states for the accumulator
// off `playing`, and the tick count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The frame, in milliseconds: one tick and a remainder. */
const FRAME_MS = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("discards the remainder of the frame whose tick opened the level-up overlay", async () => {
  const posed = isolate(h);
  h.debug.setPendingLevelUps(1);

  const after = await h.frameOf(FRAME_MS);
  captureStill(h, "discarded");

  assertEqual(after.screen, "levelup", "the screen the frame's tick opened");
  assertEqual(
    after.run.tick,
    posed.run.tick + 1,
    "run.tick after the frame of 0.025 s that opened the overlay",
  );
  assertEqual(after.accumulator, 0, "accumulator on the level-up overlay");
});
