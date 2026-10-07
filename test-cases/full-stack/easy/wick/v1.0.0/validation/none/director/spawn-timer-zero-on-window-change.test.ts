// director/spawn-timer-zero-on-window-change — the first tick of a window
// throws the timer away and spawns.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The spawn timer") states
// the order in full:
//
//   if the window index differs from the previous tick's, the window of tick − 1:
//     spawnTimer = 0
//   spawnTimer counts down
//   if spawnTimer is due and aliveCommons < cap:
//     spawn one enemy ... spawnTimer = interval
//
// Tick 1800 is the first tick of window 1: `min(19, floor(time /
// SPAWN_WINDOW))` reads 1 at `1800 / 60 / 30` and 0 at tick 1799's
// `1799 / 60 / 30` ("Windows"). So the reset fires, the posed `0.5` is thrown
// away rather than counted down, the timer is due at once by specs/world.md
// ("Timers"), one enemy spawns, and the timer is set to `interval` — row 1's
// "| 1 | 0:30 | moth, bat | 0.80 | 30 |", `0.8`, not row 0's `1.00`.
//
// 0.5 IS POSED DELIBERATELY. A build that counted the posed timer down instead
// of resetting it would spawn 30 ticks later and read `0.5 − TICK_DT` here; a
// build that reset the timer but set it from the OLD window's row would read
// `1.0`. Both are separated by the one reading.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone and
// an empty field, so `aliveCommons` is `0` against row 1's cap of 30 and the
// cap cannot be what decided the tick. The clock is posed to 1799 so that
// exactly one tick carries the run across the boundary.
//
// THE TOLERANCE. `TIMER_TOL`, the `1e-6` a timer's reading is allowed, against
// the `0.3` that separates row 1's interval from row 0's and the `0.48` that
// separates it from a counted-down `0.5`. The count and the window index are
// read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { SPAWN_WINDOWS, TIMER_TOL, windowStartTick } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

/** The window the run crosses into. */
const INTO = 1;

/** The last tick of the window before it. */
const EDGE_TICK = windowStartTick(INTO) - 1;

/** The timer posed mid-count, which the window change must throw away. */
const POSED_TIMER = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns on tick 1800 and reads window 1's interval, not the posed timer", async () => {
  await isolate(h, { on: ["spawning"] });
  await h.debug.setTick(EDGE_TICK);
  await h.debug.setSpawnTimer(POSED_TIMER);
  const before = await h.snapshot();

  const after = await h.step(1);
  await captureStill(h, "reset");

  assertEqual(after.run.tick, windowStartTick(INTO), "the tick stepped into");
  assertEqual(before.run.spawnWindow, INTO - 1, "the window of tick 1799");
  assertEqual(after.run.spawnWindow, INTO, "the window of tick 1800");
  assertEqual(
    newEnemies(before, after).length,
    1,
    "enemies the first tick of window 1 spawned",
  );
  assertNear(
    after.run.spawnTimer,
    SPAWN_WINDOWS[INTO]!.interval,
    TIMER_TOL,
    "spawnTimer after the first tick of window 1",
  );
});
