// Wick — clock/accumulator-discarded-on-pause: pausing discards the remainder.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/controls.md` ("Actions and bindings"): "`pause` | `KeyP` | edge |
//     pauses on `playing`; resumes on `paused`", and "a frame whose press leaves
//     `playing` ticks nothing and discards the accumulator"; also "a frame whose
//     press enters `playing`, from the title, an end screen, `paused`, or an
//     overlay, runs that frame's ticks".
//   - `specs/ui.md` ("What advances on each screen"): "The delta time left
//     unconsumed is discarded on any frame or pose that leaves `playing`,
//     whether a tick opened an overlay or ended the run, `pause` was pressed,
//     or the debug surface posed the screen, so the accumulator is `0` on every
//     screen but `playing` by every route."
//   - `specs/instrumentation.md` ("A render-free core"): "On `playing`, each
//     frame's delta time joins the accumulator, every whole `TICK_DT` in it is
//     consumed as a tick, and the remainder waits for the next frame."
//
// WHAT IS READ. A remainder of 0.01 s is posed by delivering a frame of 0.01 s,
// shorter than a tick, so it waits. Then `KeyP` is pressed and its frame runs:
// the press leaves `playing`, so that frame ticks nothing and the accumulator
// reads 0 on `paused`. Then `KeyP` is pressed again with a frame of 0.01 s: the
// press enters `playing` and the frame runs its ticks. Had the old 0.01 s been
// carried, 0.02 s would hold a tick; discarded, the 0.01 s alone is short of
// one, so the tick stands still and the accumulator reads 0.01. That second
// frame is what decides "carries no partial tick when it resumes".
//
// WHY A KEY. The pause is the one transition this point is about, and
// `specs/controls.md` fixes what the frame carrying its press does with the
// accumulator, so the press is delivered as a real key edge; the run beneath
// is the empty isolated night, so nothing else is in the frames.
//
// TOLERANCE. `TICK_EPSILON` (1e-9) on an accumulator the spec says is `0`, its
// own figure below which a remainder is `0`; `FIGURE_TOLERANCE` (1e-9) on the
// 0.01 s read back after resuming.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, TICK_EPSILON } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  keysOf,
  tap,
  type Harness,
} from "../harness";

/** A frame shorter than a tick: what it delivers waits in the accumulator. */
const PARTIAL_FRAME = 0.01;

/** The key `specs/controls.md` binds to `pause`. */
const PAUSE_KEY = keysOf("pause")[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves accumulator 0 on paused and resumes with no partial tick", async () => {
  const posed = isolate(h);
  const waiting = await h.frameOf(PARTIAL_FRAME);
  assertEqual(waiting.run.tick, posed.run.tick, "ticks of a 0.01 s frame");
  assertWithin(
    waiting.accumulator,
    PARTIAL_FRAME,
    FIGURE_TOLERANCE,
    "the posed remainder",
  );

  const paused = await tap(h, PAUSE_KEY);
  captureStill(h, "discarded");
  assertEqual(paused.screen, "paused", "screen after the pause press");
  assertEqual(paused.run.tick, posed.run.tick, "run.tick on paused");
  assertWithin(paused.accumulator, 0, TICK_EPSILON, "accumulator on paused");

  h.holdKey(PAUSE_KEY);
  const resumed = await h.frameOf(PARTIAL_FRAME);
  h.releaseKey(PAUSE_KEY);
  assertEqual(resumed.screen, "playing", "screen after the resume press");
  assertEqual(
    resumed.run.tick,
    posed.run.tick,
    "run.tick after resuming with a 0.01 s frame",
  );
  assertWithin(
    resumed.accumulator,
    PARTIAL_FRAME,
    FIGURE_TOLERANCE,
    "accumulator after resuming with a 0.01 s frame",
  );
});
