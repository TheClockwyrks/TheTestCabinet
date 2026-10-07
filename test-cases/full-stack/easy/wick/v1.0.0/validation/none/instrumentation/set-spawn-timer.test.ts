// Wick — instrumentation/set-spawn-timer: `setSpawnTimer(0.5)` on `playing`
// sets `spawnTimer` to 0.5, the snapshot reads it back, and with `spawning` on
// the next window spawn lands on the 30th tick after the call.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setSpawnTimer(seconds)`): "Sets `spawnTimer` to `seconds`, at least `0`."
// specs/world.md — "Timers": "a timer set to `s` seconds is due `round(s ×
// TICK_HZ)` ticks after the tick it was set on"; `round(0.5 × 60)` is 30.
// specs/enemies.md — "The spawn timer": "if spawnTimer is due and aliveCommons
// < cap: spawn one enemy". So the spawn lands on the 30th tick and on none
// before it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night in window 0 with an empty
// field, so the cap has room and no window change resets the timer; only
// `spawning` is turned on, so the one thing that can add an enemy is the timer
// coming due. The frames are stepped one at a time so the tick of the spawn is
// read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { dueTicks } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.5;
const DUE_TICK = dueTicks(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the spawn timer, and the spawn lands when it is due", async () => {
  await isolate(h);
  await h.debug.setSpawnTimer(POSED_SECONDS);
  const posed = await h.snapshot();
  assertEqual(posed.run.spawnTimer, POSED_SECONDS, "spawnTimer after the pose");
  await h.debug.setSpawning(true);

  const seen = await captureReplay(h, "timer", () =>
    h.stepWatching(DUE_TICK + 1),
  );

  for (let frame = 1; frame < DUE_TICK; frame += 1) {
    assertLength(
      seen[frame - 1]!.run.enemies,
      0,
      `enemies on tick ${frame}, before the timer is due`,
    );
  }
  assertLength(
    seen[DUE_TICK - 1]!.run.enemies,
    1,
    `enemies on tick ${DUE_TICK}, when the timer is due`,
  );
});
