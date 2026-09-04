// Wick — instrumentation/set-tick: `setTick(4500)` on `playing` sets `tick` to
// 4500, the snapshot reads `time` 75 and `spawnWindow` 2, and the next tick is
// 4501.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setTick(tick)`: "Sets `tick` to `tick`, a whole number from `0` to
// `DAWN_TIME × TICK_HZ − 1`"; the derived table: `time` is `tick / TICK_HZ`,
// `spawnWindow` is `min(19, floor(time / SPAWN_WINDOW))`. `specs/world.md`,
// "One tick": "The clock. `tick` rises by one".
//
// THE DRIVE. An isolated run, the pose, a read, and one real tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ, spawnWindowOf } from "../constants";
import {
  advanceTicks,
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

afterEach(() => {
  h.dispose();
});

it("poses the run clock and the next tick follows it", async () => {
  isolate(h);
  h.debug.setTick(POSED_TICK);
  const posed = h.snapshot();
  const next = await advanceTicks(h, 1);
  captureStill(h, "posed");

  assertEqual(posed.run.tick, POSED_TICK, "run.tick after setTick(4500)");
  assertEqual(
    posed.run.time,
    POSED_TICK / TICK_HZ,
    "run.time after setTick(4500)",
  );
  assertEqual(
    posed.run.spawnWindow,
    spawnWindowOf(POSED_TICK / TICK_HZ),
    "run.spawnWindow after setTick(4500)",
  );
  assertEqual(next.run.tick, POSED_TICK + 1, "run.tick after the next tick");
});
