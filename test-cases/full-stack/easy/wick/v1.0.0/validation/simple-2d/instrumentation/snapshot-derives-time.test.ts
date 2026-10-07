// instrumentation/snapshot-derives-time — with the tick posed to 4500 the
// snapshot reads time 75.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, the "Derived from"
// table: `time` is "`tick / TICK_HZ`" (4500 / 60 = 75). `spawnWindow` off the
// same clock is `instrumentation/snapshot-derives-spawn-window`'s.
//
// THE POSE. An isolated run with the clock through `setTick`, every switch off
// so nothing runs, and the reading taken with no tick between. `time` is a
// derivation of a stored field, so nothing has to run for it to be right.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives time from the posed clock", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  const { run } = h.snapshot();
  await h.tick(1);
  captureStill(h, "time");

  assertEqual(run.tick, TICK, "the posed tick");
  assertEqual(run.time, TICK / TICK_HZ, "time = tick / TICK_HZ");
});
