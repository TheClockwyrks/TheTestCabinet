// instrumentation/snapshot-derives-spawn-window — with the tick posed to 4500
// the snapshot reads spawnWindow 2.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, the "Derived from"
// table: `spawnWindow` is "`min(19, floor(time / SPAWN_WINDOW))`, with
// `SPAWN_WINDOW` (`30`)"; at tick 4500 the time is 75 and floor(75 / 30) = 2.
// `time` itself is `instrumentation/snapshot-derives-time`'s.
//
// THE POSE. An isolated run with the clock through `setTick`, every switch off
// so nothing runs, and the reading taken with no tick between. `spawnWindow` is
// a derivation of a stored field, so nothing has to run for it to be right.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { spawnWindowAt, TICK_HZ } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives the spawn window from the posed clock", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  const { run } = h.snapshot();
  await h.tick(1);
  captureStill(h, "window");

  assertEqual(run.tick, TICK, "the posed tick");
  assertEqual(run.spawnWindow, spawnWindowAt(TICK / TICK_HZ), "spawnWindow");
});
