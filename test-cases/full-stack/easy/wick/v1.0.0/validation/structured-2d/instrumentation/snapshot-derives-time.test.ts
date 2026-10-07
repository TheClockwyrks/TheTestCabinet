// Wick — instrumentation/snapshot-derives-time: the snapshot derives `time`
// from the clock.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// derived table under "Snapshot shape": `time` = tick / TICK_HZ, so 75 at tick
// 4500. `spawnWindow` off the same clock is
// `instrumentation/snapshot-derives-spawn-window`'s.
//
// THE POSE. An isolated run, every switch off, the clock posed to 4500. Read
// before any tick: the field derives from the state at the read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const POSED_TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads time 75 at tick 4500", async () => {
  isolate(h);
  h.debug.setTick(POSED_TICK);

  const { run } = h.snapshot();
  await h.frameDraw();
  captureStill(h, "time");

  assertEqual(run.tick, POSED_TICK, "run.tick as posed");
  assertEqual(run.time, POSED_TICK / TICK_HZ, "run.time at tick 4500");
});
