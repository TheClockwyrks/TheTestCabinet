// Wick — clock/accumulator-discarded-on-ending: a tick that ends the run
// discards the remainder.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Fallen and dawn"): "Fallen | `hp` is `0` or below. |
//     `fallen`", and "The delta time left unconsumed by the frame that ended
//     the run is discarded, so the accumulator is `0` on an end screen as on
//     every screen but `playing`."
//   - `specs/instrumentation.md` (`setHp`): "A value at or below `0` ends the
//     run fallen at the end of the next `playing` tick, through the ending
//     rule of `specs/world.md`."
//   - `specs/instrumentation.md` ("A deterministic core"): "A tick that leaves
//     `playing`, by opening an overlay or ending the run, is the last tick its
//     frame runs, and the remainder is discarded".
//
// THE DRIVE. An isolated run with `hp` posed to `0`, and one frame of 25 ms.
// Its first tick ends the run fallen, so it is the frame's last: `run.tick`
// rises by one, `screen` is `fallen`, and the frame's 8.33 ms of remainder is
// discarded rather than kept on the end screen.
//
// TOLERANCE. None: `0` is what the specification states for the accumulator
// on an end screen, and the tick count is exact.

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

it("discards the remainder of the frame whose tick ended the run fallen", async () => {
  const posed = isolate(h);
  h.debug.setHp(0);

  const after = await h.frameOf(FRAME_MS);
  captureStill(h, "discarded");

  assertEqual(after.screen, "fallen", "the screen the frame's tick ended on");
  assertEqual(
    after.run.tick,
    posed.run.tick + 1,
    "run.tick after the frame of 0.025 s that ended the run",
  );
  assertEqual(after.accumulator, 0, "accumulator on the end screen");
});
