// instrumentation/set-tick — `setTick(4500)` on playing sets tick to 4500, the
// snapshot reads time 75 and spawnWindow 2, and the next tick is 4501.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setTick`: "Sets
// `tick` to `tick`, a whole number from `0` to `DAWN_TIME × TICK_HZ − 1`
// (`35999`) ... everything derived from the clock, `time`, `spawnWindow`, ...
// follows from the next tick on"; the "Derived from" table: `time` is
// "`tick / TICK_HZ`", `spawnWindow` "`min(19, floor(time / SPAWN_WINDOW))`".
// specs/world.md, "One tick": "The clock. `tick` rises by one".
//
// THE READ. An isolated run, the pose, the snapshot without a frame, then one
// tick. What the clock does to the director (a window's spawns, a scripted
// event) belongs to `set-tick-leaves-the-rest` and `set-tick-skips-events`.

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

it("sets the clock and derives time and the window from it", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  const posed = h.snapshot();

  const next = await h.tick(1);
  captureStill(h, "posed");

  assertEqual(posed.run.tick, TICK, "run.tick at the pose");
  assertEqual(posed.run.time, TICK / TICK_HZ, "run.time derived from the pose");
  assertEqual(
    posed.run.spawnWindow,
    spawnWindowAt(TICK / TICK_HZ),
    "run.spawnWindow derived from the pose",
  );
  assertEqual(next.run.tick, TICK + 1, "run.tick after the next tick");
});
