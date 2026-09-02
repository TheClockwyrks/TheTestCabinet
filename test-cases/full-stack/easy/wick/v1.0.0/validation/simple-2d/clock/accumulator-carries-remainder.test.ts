// Wick — clock/accumulator-carries-remainder: the part of a frame shorter than
// a tick waits for the next frame.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md` ("A deterministic core"): "On `playing`, each
//     frame's delta time joins the accumulator, every whole `TICK_DT` in it is
//     consumed as a tick, and the remainder waits for the next frame."
//   - `specs/state.md` (`WickState`): "`accumulator`: the frame time waiting
//     for the next whole tick, in seconds, at least `0` and below `TICK_DT`."
//   - `specs/instrumentation.md` ("Snapshot shape"): "Every other field,
//     `accumulator` included, is read straight off the game's state".
//
// WHAT IS READ. On an isolated `playing` run, one frame of 0.025 s: it holds one
// whole tick (1 / 60 = 0.01667 s) and a remainder of 0.025 − TICK_DT. A second
// frame of 0.01 s is by itself shorter than a tick, but with the remainder it
// makes 0.035 s, which holds a second tick, and leaves 0.035 − 2 × TICK_DT
// waiting. So the second frame consuming a tick is what decides that the
// remainder was carried rather than dropped, and the two accumulator readings
// decide that what waits is exactly the unconsumed part.
//
// WHY THE NIGHT IS POSED AS IT IS. Nothing in the run matters to the division
// of frames into ticks, so the run is the empty isolated night with every
// switch off: only the clock advances.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each accumulator reading, the sum of
// two or three decimal figures a build forms in floating point; and the spec's
// own `TICK_EPSILON` is the same 1e-9, below which a remainder is `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The first frame: one tick and a remainder of 0.025 − TICK_DT. */
const FIRST_FRAME = 0.025;

/** The second frame: shorter than a tick alone, a tick with the remainder. */
const SECOND_FRAME = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries the remainder of a frame into the next", async () => {
  const posed = isolate(h);

  const first = await h.frameOf(FIRST_FRAME);
  assertEqual(first.run.tick - posed.run.tick, 1, "ticks of a 0.025 s frame");
  assertWithin(
    first.accumulator,
    FIRST_FRAME - TICK_DT,
    FIGURE_TOLERANCE,
    "accumulator after a 0.025 s frame",
  );

  const second = await h.frameOf(SECOND_FRAME);
  captureStill(h, "remainder");
  assertEqual(
    second.run.tick - posed.run.tick,
    2,
    "ticks after a 0.01 s frame joined the carried remainder",
  );
  assertWithin(
    second.accumulator,
    FIRST_FRAME + SECOND_FRAME - 2 * TICK_DT,
    FIGURE_TOLERANCE,
    "accumulator after the second frame",
  );
});
