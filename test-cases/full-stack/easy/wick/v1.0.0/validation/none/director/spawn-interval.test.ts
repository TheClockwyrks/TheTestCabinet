// director/spawn-interval — between window edges, spawns land one interval
// apart and nothing lands between.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The spawn timer"): "if
// spawnTimer is due and aliveCommons < cap: spawn one enemy ... spawnTimer =
// interval", and "A spawn therefore lands on the first tick of a run, on the
// first tick of every window, and every `interval` seconds between".
// specs/world.md ("Timers") turns the seconds into ticks: "a timer set to `s`
// seconds is due `round(s × TICK_HZ)` ticks after the tick it was set on. An
// interval of `s` seconds anywhere in this specification is likewise
// `round(s × TICK_HZ)` ticks." Row 0 of `SPAWN_WINDOWS` reads
// "| 0 | 0:00 | moth | 1.00 | 20 |", so its interval is `round(1.00 × 60)`, 60
// ticks, and the spawns land on the 1st, 61st, 121st and 181st ticks.
//
// WHAT THE READING SEPARATES. A build that spawns on the right rhythm from one
// that spawns every tick, one that spawns twice on a due tick, and one that
// counts a tick early or late: the assertion is the whole list of ticks a spawn
// landed on across three intervals, not merely that spawns arrived.
//
// WHY THIS IS NOT `window-0`. That point reads row 0's three figures; this one
// reads the timer rule the row is fed into, which every row shares. It stays
// inside window 0 (ticks 0 to 1799) so no window change can reset the timer
// mid-count, and the cap of 20 cannot bind on four spawns.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone and
// the timer posed to `0`, so the first tick is due and the rest follow from the
// rule. `enemyMotion` and `despawning` are off, so an arrival stays where it
// arrived and nothing leaves the field to be miscounted as an arrival.
//
// THE TOLERANCE. Whole ticks and whole counts, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { SPAWN_WINDOWS, dueTicks } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

/** Row 0's interval in ticks: `round(1.00 × 60)`. */
const STEP = dueTicks(SPAWN_WINDOWS[0]!.interval);

/**
 * Three whole intervals and the tick that opens them.
 *
 * The first spawn lands on the 1st tick, so the fourth lands on the
 * `3 × STEP + 1`th and the span has to reach it.
 */
const SPAN_TICKS = STEP * 3 + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands spawns 60 ticks apart in window 0 and none between", async () => {
  await isolate(h, { on: ["spawning"] });
  await h.debug.setSpawnTimer(0);

  const landed = await captureReplay(h, "interval", async () => {
    let previous = await h.snapshot();
    const ticks: number[] = [];
    for (let tick = 1; tick <= SPAN_TICKS; tick += 1) {
      const after = await h.step(1);
      for (let each = newEnemies(previous, after).length; each > 0; each -= 1) {
        ticks.push(tick);
      }
      previous = after;
    }
    return ticks;
  });

  assertDeepEqual(
    landed,
    [1, 1 + STEP, 1 + 2 * STEP, 1 + 3 * STEP],
    `the ticks of window 0 a spawn landed on across ${SPAN_TICKS} ticks`,
  );
});
