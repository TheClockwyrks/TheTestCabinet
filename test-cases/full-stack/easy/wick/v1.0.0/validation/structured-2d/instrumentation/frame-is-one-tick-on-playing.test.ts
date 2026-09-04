// Wick — instrumentation/frame-is-one-tick-on-playing: on `playing`, each
// scripted frame of exactly `TICK_DT` consumes exactly one tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "A
// deterministic core": "A tick is consumed while the accumulator is at least
// `TICK_DT − TICK_EPSILON` ... and a remainder whose magnitude is below
// `TICK_EPSILON` is `0`, so ... sixty frames of `1 / 60` seconds run exactly
// `60`"; "What the runtime provides instead": "a `ConstantClock` of
// `1000 / 60` milliseconds with `engine.advance`, so one frame on `playing`
// consumes exactly one tick"; "`simTime` rises by every frame's delta time".
//
// THE DRIVE. An isolated run, thirty frames of the harness's one-tick clock:
// `run.tick` up by 30, `simTime` up by `30 × TICK_DT`, and the accumulator
// where it stood (0). `MOTION_EPS` on `simTime`, a sum of thirty reals;
// `REAL_EPS` on the accumulator, which the epsilon rule holds at 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, REAL_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
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
  h.dispose();
});

it("raises run.tick by 30 and simTime by 30 × TICK_DT over thirty frames", async () => {
  const before = isolate(h);
  const after = await captureReplay(h, "thirty", () => advanceTicks(h, FRAMES));

  assertEqual(after.run.tick - before.run.tick, FRAMES, "run.tick gained");
  assertNear(
    after.simTime - before.simTime,
    FRAMES * TICK_DT,
    MOTION_EPS,
    "simTime gained",
  );
  assertNear(
    after.accumulator,
    before.accumulator,
    REAL_EPS,
    "accumulator after thirty whole-tick frames",
  );
});
