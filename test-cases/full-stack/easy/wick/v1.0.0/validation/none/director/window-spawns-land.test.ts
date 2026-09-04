// director/window-spawns-land — the director puts an enemy on the field.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The spawn director"): "The
// spawn director decides what enters the night. It runs on every tick of the
// `playing` screen ... the spawn timer counts and spawns while `spawning` is
// on." What it is due to do at the top of a run is fixed twice over. Row 0 of
// `SPAWN_WINDOWS` ("Windows") reads "| 0 | 0:00 | moth | 1.00 | 20 |", one
// spawn every second up to twenty alive, and the timer ("The spawn timer") "is
// set to `0` when a run starts ... A spawn therefore lands on the first tick of
// a run, on the first tick of every window, and every `interval` seconds
// between".
//
// 120 TICKS IS TWO WHOLE INTERVALS of that row, `round(1.00 × TICK_HZ)` ticks
// each by specs/world.md ("Timers"), so a build that spawns on the run's first
// tick, or waits its first whole interval, or waits two, all land inside the
// span. Nothing here says which type arrived or where: that is `window-0` and
// `spawn-ring-distance`. This point is the one a build that never spawns at all
// fails, which is why its cap is `broken`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone: the
// field starts empty, so the enemy read at the end arrived from the director
// and from nothing else, and no despawn, no scripted event, no motion and no
// weapon can take it away again before it is read.
//
// THE TOLERANCE. A count of enemies, read exactly. The span is a whole number
// of ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { SPAWN_WINDOWS, dueTicks } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** Two whole intervals of row 0: `round(1.00 × 60) × 2`. */
const SPAN_TICKS = dueTicks(SPAWN_WINDOWS[0]!.interval) * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts an enemy on the field within the first 120 ticks of a run", async () => {
  await isolate(h, { on: ["spawning"] });

  const found = await h.stepUntil(
    (snapshot) => (snapshot.run.enemies ?? []).length > 0,
    { maxTicks: SPAN_TICKS },
  );
  await captureStill(h, "spawned");

  assertTrue(
    found.hit,
    `an enemy on the field within the run's first ${SPAN_TICKS} ticks (the field held ${(found.snapshot.run.enemies ?? []).length} after ${found.ticks})`,
  );
});
