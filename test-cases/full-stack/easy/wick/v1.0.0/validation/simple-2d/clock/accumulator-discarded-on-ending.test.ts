// Wick — clock/accumulator-discarded-on-ending: a tick that ends the run
// discards the frame's remainder.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Fallen and dawn"): "Fallen | `hp` is `0` or below. |
//     `fallen`", "A run that has ended ticks no further", and "The delta time
//     left unconsumed by the frame that ended the run is discarded, so the
//     accumulator is `0` on an end screen as on every screen but `playing`."
//   - `specs/instrumentation.md` (`setHp`): "A value at or below `0` ends the
//     run fallen at the end of the next `playing` tick, through the ending rule
//     of `specs/world.md`."
//   - `specs/instrumentation.md` ("A deterministic core"): "A tick that leaves
//     `playing`, by opening an overlay or ending the run, is the last tick its
//     frame runs, and the remainder is discarded".
//
// WHAT IS READ. With `hp` posed to 0, a frame of 0.025 s: its first tick ends
// the run fallen, so that tick is the last the frame runs and the
// 0.025 − TICK_DT left over is discarded. The snapshot after the frame must
// show `fallen`, one tick gained, and an accumulator of 0.
//
// WHY THE NIGHT IS POSED AS IT IS. The empty isolated night, so the only thing
// the tick does is end the run; `hp` is posed to 0 through its own operation,
// which the spec names as the way a scenario reaches the fallen ending.
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

it("discards the remainder of the frame whose tick ended the run", async () => {
  const posed = isolate(h);
  h.debug.setHp(0);

  const after = await h.frameOf(FRAME);
  captureStill(h, "discarded");

  assertEqual(after.screen, "fallen", "screen after the frame");
  assertEqual(after.run.tick - posed.run.tick, 1, "ticks the frame ran");
  assertWithin(
    after.accumulator,
    0,
    TICK_EPSILON,
    "accumulator on the end screen",
  );
});
