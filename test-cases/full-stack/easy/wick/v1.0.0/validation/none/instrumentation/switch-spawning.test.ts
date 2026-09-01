// Wick — instrumentation/switch-spawning: with `setSpawning(false)`,
// `spawnTimer` holds where it stands across a window change and no window
// spawn lands over 120 ticks; with the switch back on the timer counts and
// spawns resume.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "`setSpawning(on)` | `spawning` | ... | The timer holds where it
// stands and no window spawn lands." specs/enemies.md — "The spawn timer":
// "While `spawning` is off the timer holds where it stands, a window change
// included, and no window spawn lands"; and with it on, "spawnTimer counts
// down; if spawnTimer is due and aliveCommons < cap: spawn one enemy". The
// held timer is read exactly, since holding is not counting slowly.
//
// WHY THE WORLD IS POSED AS IT IS. The clock is posed ten ticks short of the
// first window change, so the 120 held ticks carry the run across it, which
// is the case the sentence singles out; the timer is posed to a figure that is
// not `0`, so a held timer is told from one reset by the window change. Then
// the switch is turned back on and the run stepped past the timer's due tick,
// so a spawn must have landed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { dueTicks, windowStartTick } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.7;
const TICKS_BEFORE_WINDOW = 10;
const HELD_TICKS = 120;
/** Ticks run with the switch back on: past the held timer's due tick. */
const RESUMED_TICKS = dueTicks(POSED_SECONDS) + 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the spawn timer and the window spawns while off, and resumes them", async () => {
  await isolate(h);
  await h.debug.setTick(windowStartTick(1) - TICKS_BEFORE_WINDOW);
  await h.debug.setSpawnTimer(POSED_SECONDS);

  const held = await captureReplay(h, "held", () => h.step(HELD_TICKS));
  assertEqual(held.run.spawnWindow, 1, "the window the held ticks carried the run into");
  assertEqual(held.run.spawnTimer, POSED_SECONDS, "spawnTimer held across the window change");
  assertLength(held.run.enemies, 0, "window spawns while the switch is off");

  await h.debug.setSpawning(true);
  const resumed = await h.step(RESUMED_TICKS);
  assertGreaterThan(resumed.run.enemies.length, 0, "spawns once the switch is back on");
  assertEqual(
    resumed.run.spawnTimer === POSED_SECONDS,
    false,
    "spawnTimer counting once the switch is back on",
  );
});
