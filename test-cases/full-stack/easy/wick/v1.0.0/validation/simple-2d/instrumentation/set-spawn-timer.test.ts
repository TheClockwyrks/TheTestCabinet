// instrumentation/set-spawn-timer — `setSpawnTimer(0.5)` on playing sets
// spawnTimer to 0.5, and with spawning on the next window spawn lands on the
// 30th tick after the call.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setSpawnTimer`:
// "Sets `spawnTimer` to `seconds`, at least `0`". specs/world.md, "Timers": "a
// timer set to `s` seconds is due `round(s × TICK_HZ)` ticks after the tick it
// was set on" (0.5 × 60 = 30). specs/enemies.md, "The spawn timer": on every
// tick spawning is on, "spawnTimer counts down; if spawnTimer is due and
// aliveCommons < cap: spawn one enemy".
//
// THE POSE. An isolated run at tick 0 in window 0, so no window change resets
// the timer; the pose, then `spawning` on and a trace of the ticks: the field
// is empty through tick 29 and holds one enemy on tick 30, exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.5;
const DUE_TICK = ticksFor(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the timer and lands the spawn when it is due", async () => {
  isolate(h);
  h.debug.setSpawnTimer(POSED_SECONDS);
  assertWithin(
    h.snapshot().run.spawnTimer,
    POSED_SECONDS,
    FIGURE_TOLERANCE,
    "spawnTimer read back",
  );
  enable(h, "spawning");

  const seen = await captureReplay(h, "timer", () =>
    h.trace(DUE_TICK, (s) => s.run.enemies.length > 0),
  );

  assertEqual(seen.length, DUE_TICK, "the tick the first spawn landed on");
  assertEqual(
    seen[DUE_TICK - 2].run.enemies.length,
    0,
    "the field a tick before it was due",
  );
  assertEqual(
    seen[DUE_TICK - 1].run.enemies.length,
    1,
    "the spawn on the due tick",
  );
});
