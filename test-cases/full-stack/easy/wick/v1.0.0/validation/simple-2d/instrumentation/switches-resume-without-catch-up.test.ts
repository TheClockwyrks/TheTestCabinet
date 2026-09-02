// instrumentation/switches-resume-without-catch-up — with spawning off for
// 300 ticks in window 0 and then on, exactly one spawn lands when the held
// timer is next due rather than the five the window would have spawned.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches": "turning one back on resumes that faculty from the next tick,
// with no catching up for the ticks it missed". specs/enemies.md, window 0:
// one moth every 1.00 s, so 300 held ticks are five missed spawns; "The spawn
// timer": on every tick spawning is on the timer counts down and a due timer
// spawns one enemy and is set to the interval. specs/world.md, "Timers": a
// 0.5 s timer is due 30 ticks on.
//
// THE POSE. An isolated run at tick 0 with the timer posed to 0.5, held off
// for 300 ticks, then on. The field holds nothing through the 29th tick, one
// moth on the 30th, and still one moth on the 89th, the interval's 60 ticks
// not yet elapsed, so nothing caught up.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SPAWN_WINDOWS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const HELD_TICKS = 300;
const POSED_TIMER = 0.5;
const DUE_TICK = ticksFor(POSED_TIMER);
const INTERVAL_TICKS = ticksFor(SPAWN_WINDOWS[0].interval);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lands one spawn when the held timer is due and none for the missed ticks", async () => {
  isolate(h);
  h.debug.setSpawnTimer(POSED_TIMER);
  const held = await h.tick(HELD_TICKS);
  assertLength(held.run.enemies, 0, "the field after 300 held ticks");

  enable(h, "spawning");
  const seen = await captureReplay(h, "resumed", () =>
    h.trace(DUE_TICK + INTERVAL_TICKS - 1),
  );

  assertLength(
    seen[DUE_TICK - 2].run.enemies,
    0,
    "the field a tick before the timer was due",
  );
  assertLength(seen[DUE_TICK - 1].run.enemies, 1, "the spawn on the due tick");
  assertEqual(
    seen[seen.length - 1].run.enemies.length,
    1,
    "the field a tick before the next interval: no catching up",
  );
});
