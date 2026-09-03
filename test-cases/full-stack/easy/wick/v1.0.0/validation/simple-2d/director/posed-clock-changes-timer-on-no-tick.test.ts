// director/posed-clock-changes-timer-on-no-tick — a clock the surface poses
// leaves the spawn timer where it stands.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn timer"): "a clock the debug surface poses
//     changes the timer on no tick of its own", and the timer's rule reads the
//     window of the previous tick: "if the window index differs from the
//     previous tick's, the window of tick − 1: spawnTimer = 0".
//   - `specs/instrumentation.md` (`setTick`): "Sets `tick` to `tick` ... Nothing
//     else changes: `spawnTimer`, `firedEvents`, and every live entity stay as
//     they stand, and everything derived from the clock ... follows from the
//     next tick on."
//   - `specs/world.md` ("Timers"): "On every tick a timer counts down by
//     `TICK_DT`".
//
// WHAT IS READ. The timer is posed to 0.5 at tick 100, the clock is then posed
// forward to tick 1900, and one tick is run. Tick 1901's window and tick 1900's
// are both window 1, so the window-change rule does not fire, and the tick may
// only count the posed timer down by one `TICK_DT`: the timer must read
// 0.5 − 1/60. A build that zeroed the timer because the clock crossed a window
// edge while nothing ticked reads 0.8 instead, and one that zeroed it on the
// pose reads 0 and spawns.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on, so the timer counts;
// the field is empty, so nothing about the cap can hold the count.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the timer, a figure the tick counted
// down.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import { MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** The tick the timer is posed at, well inside window 0. */
const POSED_AT_TICK = 100;

/** The tick the clock is carried to, inside window 1. */
const CARRIED_TO_TICK = 1900;

/** The timer posed mid-count. */
const POSED_TIMER = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the spawn timer across a posed clock", async () => {
  isolate(h);
  enable(h, "spawning");
  h.debug.setTick(POSED_AT_TICK);
  h.debug.setSpawnTimer(POSED_TIMER);
  h.debug.setTick(CARRIED_TO_TICK);

  const after = await h.tick(1);
  captureStill(h, "kept");

  assertWithin(
    after.run.spawnTimer,
    POSED_TIMER - TICK_DT,
    MOTION_TOLERANCE,
    "the spawn timer one tick after the clock was posed",
  );
  assertLength(after.run.enemies, 0, "enemies after that tick");
});
