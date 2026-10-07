// Wick — instrumentation/snapshot-derives-spawn-window: with the tick posed to
// 4500 the snapshot reads `spawnWindow` 2.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape",
// the derived-fields table): "`spawnWindow` | `min(19, floor(time /
// SPAWN_WINDOW))`, with `SPAWN_WINDOW` (`30`)". At tick `4500` the time is `75`
// and `floor(75 / 30)` is `2`. `time` itself is
// `instrumentation/snapshot-derives-time`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held,
// so nothing runs between the pose and the read and the figure read is the
// derivation of the tick alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { spawnWindowIndex, TICK_HZ } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const POSED_TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives the spawn window from the clock", async () => {
  await isolate(h);
  await h.debug.setTick(POSED_TICK);
  const s = await h.snapshot();
  await captureStill(h, "window");

  assertEqual(s.run.tick, POSED_TICK, "the posed tick");
  assertEqual(
    s.run.spawnWindow,
    spawnWindowIndex(POSED_TICK / TICK_HZ),
    "spawnWindow from the time",
  );
});
