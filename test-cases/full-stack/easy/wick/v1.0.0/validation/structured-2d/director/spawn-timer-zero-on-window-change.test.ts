// director/spawn-timer-zero-on-window-change — a new window restarts the timer.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn timer", first line of the rule
// the director runs on every tick `spawning` is on:
//
//   if the window index differs from the previous tick's, the window of tick − 1:
//     spawnTimer = 0
//   spawnTimer counts down
//   if spawnTimer is due and aliveCommons < cap: ... spawnTimer = interval
//
// and the sentence that follows it: "A spawn therefore lands on the first tick
// of a run, on the first tick of every window". `specs/state.md` says the same
// of the field: `spawnTimer` "is `0` when a run starts and on a tick that
// crosses into a new window while `spawning` is on."
//
// WHICH EDGE, AND WHY THIS ONE. "Windows" makes the index
// `min(19, floor(time / SPAWN_WINDOW))` with `SPAWN_WINDOW` (`30`) seconds, so
// tick 1799 (`29.983` s) is window 0 and tick 1800 (`30` s) is window 1: the
// first edge of the night, reached with one tick from a posed clock. Window
// 1's row gives an interval of `0.80` seconds and a cap of 30, and nothing is
// alive, so the spawn the reset makes due lands and leaves the timer at that
// interval.
//
// WHAT SEPARATES A CONFORMANT BUILD FROM ONE THAT ONLY COUNTS DOWN. The timer
// is posed to `0.5` on tick 1799. A build that ignores the window change
// counts it to `0.48333`, spawns nothing, and reads that; a build that applies
// the reset spawns one enemy and reads `0.8`. Both readings are taken.
//
// THE DRIVE. The isolated world, the clock posed to 1799, the timer posed to
// 0.5, `spawning` alone on, and one tick.
//
// THE TOLERANCE. `REAL_EPS` on the timer, which the build sets from the
// window's table figure and the check compares against that same figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, SPAWN_WINDOW, SPAWN_WINDOWS, TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** The first tick of window 1, and the last of window 0. */
const EDGE_TICK = SPAWN_WINDOW * TICK_HZ;
const BEFORE_EDGE = EDGE_TICK - 1;

/** The timer posed mid-count, which the window change must discard. */
const POSED_TIMER = 0.5;

/** Window 1's interval, the value the timer is set to after the spawn. */
const WINDOW_1_INTERVAL = SPAWN_WINDOWS[1].interval;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("discards the posed timer on the first tick of window 1, spawning and reading 0.8", async () => {
  isolate(h);
  h.debug.setTick(BEFORE_EDGE);
  h.debug.setSpawnTimer(POSED_TIMER);
  enable(h, "spawning");

  const after = await advanceTicks(h, 1);
  captureStill(h, "reset");

  assertEqual(after.run.tick, EDGE_TICK, "the tick the drive reached");
  assertEqual(
    after.run.spawnWindow,
    1,
    `the window index at tick ${EDGE_TICK}`,
  );
  assertEqual(
    after.run.enemies.length,
    1,
    `the enemies the director spawned on the first tick of window 1, with ${POSED_TIMER} s posed on the timer`,
  );
  assertNear(
    after.run.spawnTimer,
    WINDOW_1_INTERVAL,
    REAL_EPS,
    "spawnTimer after the first tick of window 1",
  );
});
