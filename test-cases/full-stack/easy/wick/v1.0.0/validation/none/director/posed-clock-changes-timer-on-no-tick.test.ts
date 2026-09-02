// director/posed-clock-changes-timer-on-no-tick — moving the clock with
// `setTick` does not reset the spawn timer.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The spawn timer") states
// the reset against the arithmetic of the clock rather than against the run's
// history: "if the window index differs from the previous tick's, the window of
// tick − 1: spawnTimer = 0", and draws the consequence out loud: "a clock the
// debug surface poses changes the timer on no tick of its own".
// specs/instrumentation.md says the same from the operation's side —
// `setTick(tick)`: "Nothing else changes: `spawnTimer`, `firedEvents`, and
// every live entity stay as they stand".
//
// THE READING. With the clock posed to 1900 and the timer to `0.5`, the next
// tick is 1901. `min(19, floor(time / SPAWN_WINDOW))` reads 1 at tick 1901 and
// 1 at tick 1900, the tick before it, so the indices agree, no reset fires, and
// the timer merely counts down: `0.5 − TICK_DT`, by specs/world.md ("Timers"),
// "On every tick a timer counts down by `TICK_DT`".
//
// THE JUMP CROSSES A WINDOW BOUNDARY, which is what makes the reading decide
// anything: tick 100 is in window 0 and tick 1900 in window 1. A build that
// remembered the window of the tick it last RAN, rather than reading the window
// of tick − 1, compares window 1 against window 0, fires the reset and reads
// `0` here, and spawns an enemy on the strength of it. Both readings separate
// that build from one that follows the stated rule.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone, so
// the timer counts at all — "A timer held by one of the driver switches ...
// `spawnTimer` while `spawning` is off, neither counts down nor is due"
// (specs/world.md) — and an empty field, so the cap cannot be what held a
// spawn back.
//
// THE TOLERANCE. `TIMER_TOL`, the `1e-6` a timer's reading is allowed, against
// the `TICK_DT` of `0.0167` that separates a counted timer from an uncounted
// one and the `0.483` that separates it from a reset one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { TICK_DT, TIMER_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

/** Where the clock starts: inside window 0. */
const FROM_TICK = 100;

/** Where it is posed to: inside window 1. */
const TO_TICK = 1900;

/** The timer posed mid-count. */
const POSED_TIMER = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("counts the posed timer down across a posed clock rather than resetting it", async () => {
  await isolate(h, { on: ["spawning"] });
  await h.debug.setTick(FROM_TICK);
  await h.debug.setSpawnTimer(POSED_TIMER);
  await h.debug.setTick(TO_TICK);
  const before = await h.snapshot();

  const after = await h.step(1);
  await captureStill(h, "kept");

  assertNear(
    before.run.spawnTimer,
    POSED_TIMER,
    TIMER_TOL,
    "spawnTimer across the posed clock, before any tick",
  );
  assertNear(
    after.run.spawnTimer,
    POSED_TIMER - TICK_DT,
    TIMER_TOL,
    `spawnTimer after the tick following a clock posed from ${FROM_TICK} to ${TO_TICK}`,
  );
  assertEqual(newEnemies(before, after).length, 0, "enemies that tick spawned");
});
