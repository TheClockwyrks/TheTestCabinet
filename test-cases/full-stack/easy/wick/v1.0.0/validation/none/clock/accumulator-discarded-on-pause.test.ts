// clock/accumulator-discarded-on-pause — pressing pause discards the
// remainder, and the run resumes with no partial tick in hand.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("What advances on each
// screen"): "The delta time left unconsumed is discarded on any frame or pose
// that leaves `playing`, whether a tick opened an overlay or ended the run,
// `pause` was pressed, or the debug surface posed the screen, so the
// accumulator is `0` on every screen but `playing` by every route."
// specs/controls.md: "a frame whose press leaves `playing` ticks nothing and
// discards the accumulator", and `pause` is bound to `KeyP`, read as an edge,
// which "pauses on `playing`; resumes on `paused`". specs/instrumentation.md
// fixes the pose: `advance(seconds)` puts "the remainder waiting in
// `accumulator`", and a tick is consumed only "while the accumulator is at
// least `TICK_DT − TICK_EPSILON`".
//
// THE DRIVE. A frame of `0.01` s poses a remainder short of a tick. `KeyP`
// then runs the frame that pauses: `screen` is `paused` and `accumulator`
// reads `0`. `KeyP` again resumes, and that frame's own tick runs directly
// (specs/controls.md: "a frame whose press enters `playing` ... runs that
// frame's ticks"). Then a frame of `0.01` s more: a build that discarded the
// first remainder holds `0.01` and ticks nothing, while a build that carried
// it across the pause holds `0.02`, past a tick, and runs one. So the
// resumed clock reads exactly what the resume frame left it at, and the
// accumulator reads `0.01`.
//
// THE NIGHT. An isolated run with every faculty held and nothing in it; the
// pause key is the requirement's own route and the only key pressed.
//
// THE TOLERANCE. `ACCUMULATOR_TOL`, the `1e-9` the specification reads a
// remainder at; the readings this separates are `0` from `0.01`, and one tick
// from none.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ACCUMULATOR_TOL } from "../constants";
import {
  advanceBy,
  captureStill,
  createHarness,
  isolate,
  pressPause,
  type Harness,
} from "../harness";

/** A frame short of a tick: the remainder the pause finds waiting. */
const REMAINDER = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards the remainder when pause is pressed, and resumes with no partial tick", async () => {
  const posed = await isolate(h);
  const partial = await advanceBy(h, REMAINDER);
  const paused = await pressPause(h);
  await captureStill(h, "discarded");
  const resumed = await pressPause(h);
  const after = await advanceBy(h, REMAINDER);

  assertEqual(
    partial.run.tick,
    posed.run.tick,
    "run.tick after a frame of 0.01 s: short of a tick",
  );
  assertNear(
    partial.accumulator,
    REMAINDER,
    ACCUMULATOR_TOL,
    "the remainder posed before the pause",
  );
  assertEqual(paused.screen, "paused", "the screen after KeyP on playing");
  assertNear(
    paused.accumulator,
    0,
    ACCUMULATOR_TOL,
    "accumulator on paused, the remainder discarded",
  );
  assertEqual(resumed.screen, "playing", "the screen after KeyP on paused");
  assertEqual(
    after.run.tick,
    resumed.run.tick,
    "run.tick after 0.01 s more on resuming: no partial tick carried across the pause",
  );
  assertNear(
    after.accumulator,
    REMAINDER,
    ACCUMULATOR_TOL,
    "accumulator after 0.01 s on resuming: this frame's delta alone",
  );
});
