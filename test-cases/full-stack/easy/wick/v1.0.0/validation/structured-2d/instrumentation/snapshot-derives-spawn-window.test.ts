// Wick — instrumentation/snapshot-derives-spawn-window: the snapshot derives
// `spawnWindow` from the clock.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// derived table under "Snapshot shape": `spawnWindow` = min(19, floor(time /
// SPAWN_WINDOW (30))), so 2 at 75 s. `time` itself is
// `instrumentation/snapshot-derives-time`'s.
//
// THE POSE. An isolated run, every switch off, the clock posed to 4500. Read
// before any tick: the field derives from the state at the read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ, spawnWindowOf } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const POSED_TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads spawnWindow 2 at tick 4500", async () => {
  isolate(h);
  h.debug.setTick(POSED_TICK);

  const { run } = h.snapshot();
  await h.frameDraw();
  captureStill(h, "window");

  assertEqual(run.tick, POSED_TICK, "run.tick as posed");
  assertEqual(
    run.spawnWindow,
    spawnWindowOf(POSED_TICK / TICK_HZ),
    "run.spawnWindow at 75 s",
  );
});
