// instrumentation/switch-spawning — with `setSpawning(false)`, spawnTimer
// holds where it stands across a window change and no window spawn lands over
// 120 ticks; with the switch back on the timer counts and the spawn lands
// when it is due.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches", `spawning` off: "The timer holds where it stands and no window
// spawn lands". specs/enemies.md, "The spawn timer": "While `spawning` is off
// the timer holds where it stands, a window change included, and no window
// spawn lands"; on, "spawnTimer counts down; if spawnTimer is due ... spawn
// one enemy". specs/world.md, "Timers": a timer of `s` seconds is due
// `round(s × TICK_HZ)` ticks after it is set.
//
// THE POSE. An isolated run with the clock at 1740, sixty ticks short of the
// window-1 boundary at 1800, and the timer posed to 0.7. A hundred and twenty
// ticks carry the clock across the boundary: the timer still reads 0.7 and the
// field is empty. Then the switch on: the timer is due 42 ticks later, and the
// trace finds the first spawn on exactly that tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  SPAWN_WINDOW,
  TICK_HZ,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const BOUNDARY_TICK = SPAWN_WINDOW * TICK_HZ;
const START_TICK = BOUNDARY_TICK - 60;
const HELD_TICKS = 120;
const POSED_TIMER = 0.7;
const DUE_TICK = ticksFor(POSED_TIMER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the timer and the spawns off, then resumes when the timer is due", async () => {
  isolate(h);
  h.debug.setTick(START_TICK);
  h.debug.setSpawnTimer(POSED_TIMER);

  const held = await captureReplay(h, "held", () => h.tick(HELD_TICKS));
  assertEqual(held.run.spawnWindow, 1, "the window the clock crossed into");
  assertWithin(
    held.run.spawnTimer,
    POSED_TIMER,
    FIGURE_TOLERANCE,
    "spawnTimer held across the window change",
  );
  assertLength(held.run.enemies, 0, "the field with spawning off");

  enable(h, "spawning");
  const seen = await h.trace(DUE_TICK, (s) => s.run.enemies.length > 0);
  assertEqual(
    seen.length,
    DUE_TICK,
    "the tick the resumed timer's spawn landed on",
  );
  assertLength(seen[DUE_TICK - 1].run.enemies, 1, "the spawn on the due tick");
});
