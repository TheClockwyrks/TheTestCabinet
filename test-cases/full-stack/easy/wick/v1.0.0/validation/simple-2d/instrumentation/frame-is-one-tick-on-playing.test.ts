// instrumentation/frame-is-one-tick-on-playing — on playing, each scripted
// frame of exactly TICK_DT consumes exactly one tick, so 30 such frames raise
// run.tick by 30 and simTime by 30 × TICK_DT and leave the accumulator as it
// stood.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "A render-free
// core": "On `playing`, each frame's delta time joins the accumulator, every
// whole `TICK_DT` in it is consumed as a tick, and the remainder waits for the
// next frame. A tick is consumed while the accumulator is at least
// `TICK_DT − TICK_EPSILON` ... so ... sixty frames of `1 / 60` seconds run
// exactly `60`"; and "a scenario pairs a `ConstantClock` of `1000 / 60`
// milliseconds with `engine.advance`, so one frame on `playing` consumes
// exactly one tick". `simTime` "rises by every frame's delta time".
//
// THE READ. The harness's clock is that ConstantClock. Thirty frames on an
// isolated run: the tick count rises by thirty exactly, simTime by thirty
// TICK_DT within MOTION_TOLERANCE (a sum of thirty decimal deltas), and the
// accumulator reads what it read before, 0 within the spec's own
// TICK_EPSILON, since "a remainder whose magnitude is below `TICK_EPSILON` is
// `0`".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { MOTION_TOLERANCE, TICK_DT, TICK_EPSILON } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("consumes one tick per frame of TICK_DT", async () => {
  const posed = isolate(h);

  const after = await captureReplay(h, "thirty", () => h.tick(FRAMES));

  assertEqual(
    after.run.tick - posed.run.tick,
    FRAMES,
    "run.tick raised by the frames",
  );
  assertWithin(
    after.simTime - posed.simTime,
    FRAMES * TICK_DT,
    MOTION_TOLERANCE,
    "simTime raised by the frames' deltas",
  );
  assertWithin(
    after.accumulator,
    posed.accumulator,
    TICK_EPSILON,
    "the accumulator, as it stood",
  );
});
