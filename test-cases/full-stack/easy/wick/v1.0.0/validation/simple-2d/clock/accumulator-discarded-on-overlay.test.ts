// Wick — clock/accumulator-discarded-on-overlay: a tick that opens an overlay
// discards the frame's remainder.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md` ("A render-free core"): "A tick that leaves
//     `playing`, by opening an overlay or ending the run, is the last tick its
//     frame runs, and the remainder is discarded ... On every other screen a
//     frame ticks nothing and the accumulator holds `0`."
//   - `specs/progression.md` ("The level-up overlay"): "A `playing` tick that
//     ends with `pendingLevelUps` above `0` runs to completion and then opens
//     the overlay: `screen` becomes `levelup`".
//   - `specs/instrumentation.md` (`setPendingLevelUps`): "A `playing` tick that
//     ends with it above `0` opens the overlay exactly as a gain does."
//   - `specs/ui.md` ("What advances on each screen"): "The delta time left
//     unconsumed is discarded on any frame or pose that leaves `playing`,
//     whether a tick opened an overlay or ended the run".
//
// WHAT IS READ. With one level-up queued, a frame of 0.025 s: its first tick
// opens the overlay, so that tick is the last the frame runs, and the
// 0.025 − TICK_DT left over is discarded rather than kept waiting. The snapshot
// after the frame must show `levelup`, one tick gained, and an accumulator of 0.
//
// WHY THE NIGHT IS POSED AS IT IS. The empty isolated night, so the only thing
// the tick does is open the overlay; the level-up is queued through its own
// pose, which is the precondition the spec names for the overlay to open.
//
// TOLERANCE. `TICK_EPSILON` (1e-9) on the accumulator, the spec's own figure
// below which a remainder is `0`; none on the tick count or the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { TICK_EPSILON } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** One tick and a remainder of 0.025 − TICK_DT, the part that must go. */
const FRAME = 0.025;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("discards the remainder of the frame whose tick opened the overlay", async () => {
  const posed = isolate(h);
  h.debug.setPendingLevelUps(1);

  const after = await h.frameOf(FRAME);
  captureStill(h, "discarded");

  assertEqual(after.screen, "levelup", "screen after the frame");
  assertEqual(after.run.tick - posed.run.tick, 1, "ticks the frame ran");
  assertWithin(
    after.accumulator,
    0,
    TICK_EPSILON,
    "accumulator on the overlay",
  );
});
