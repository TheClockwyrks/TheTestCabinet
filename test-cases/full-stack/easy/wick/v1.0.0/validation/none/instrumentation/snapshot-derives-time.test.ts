// Wick — instrumentation/snapshot-derives-time: with the tick posed to 4500 the
// snapshot reads `time` 75.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape",
// the derived-fields table): "`time` | `tick / TICK_HZ`". `4500 / 60` is `75`
// exactly. `spawnWindow` off the same clock is
// `instrumentation/snapshot-derives-spawn-window`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// so nothing runs between the pose and the read and the figure read is the
// derivation of the tick alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const POSED_TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives time from the clock", async () => {
  await isolate(h);
  await h.debug.setTick(POSED_TICK);
  const s = await h.snapshot();
  await captureStill(h, "time");

  assertEqual(s.run.tick, POSED_TICK, "the posed tick");
  assertEqual(s.run.time, POSED_TICK / TICK_HZ, "time from the tick");
});
