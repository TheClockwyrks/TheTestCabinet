// Wick — instrumentation/set-tick: `setTick(4500)` on `playing` sets `tick` to
// 4500, the snapshot reads `time` 75 and `spawnWindow` 2, and the next tick is
// 4501.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setTick(tick)`):
// "Sets `tick` to `tick`, a whole number from `0` to `DAWN_TIME × TICK_HZ − 1`
// ... everything derived from the clock, `time`, `spawnWindow` ... follows from
// the next tick on"; the derived-fields table gives `time` as `tick / TICK_HZ`
// and `spawnWindow` as `min(19, floor(time / SPAWN_WINDOW))`; and "One tick" of
// specs/world.md begins "`tick` rises by one".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, so the one stepped tick
// counts and does nothing else that could change the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { spawnWindowIndex, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const POSED_TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the run clock, with its derived fields, and counts on from it", async () => {
  await isolate(h);
  await h.debug.setTick(POSED_TICK);
  const posed = await h.snapshot();
  await captureStill(h, "posed");

  assertEqual(posed.run.tick, POSED_TICK, "tick after setTick");
  assertEqual(posed.run.time, POSED_TICK / TICK_HZ, "time after setTick");
  assertEqual(
    posed.run.spawnWindow,
    spawnWindowIndex(POSED_TICK / TICK_HZ),
    "spawnWindow after setTick",
  );

  const next = await h.step(1);
  assertEqual(next.run.tick, POSED_TICK + 1, "tick after the next tick");
});
