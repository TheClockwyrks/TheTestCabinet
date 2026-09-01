// Wick — instrumentation/switches-resume-without-catch-up: with `spawning` off
// for 300 ticks in window 0 and then on, exactly one spawn lands when the held
// timer is next due rather than the five the window would have spawned.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "turning one back on resumes that faculty from the next tick,
// with no catching up for the ticks it missed." specs/enemies.md — "The spawn
// timer": "It is set to `0` when a run starts"; on a tick the switch is on,
// "if spawnTimer is due ...: spawn one enemy ... spawnTimer = interval", and
// window 0's interval is 1.00 s, so a timer of `0` is due on the first resumed
// tick and the next spawn is 60 ticks later.
//
// WHY THE WORLD IS POSED AS IT IS. A fresh isolated run holds the timer at `0`;
// 300 held ticks are five intervals of window 0. On the first tick with the
// switch on exactly one moth must land, and none for the 59 after it; a build
// that catches up lands more on the first tick or in the ticks after.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { dueTicks, SPAWN_WINDOWS } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const HELD_TICKS = 300;
/** Ticks before the next spawn once the timer is set to window 0's interval. */
const INTERVAL_TICKS = dueTicks(SPAWN_WINDOWS[0]!.interval);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands one spawn when the held timer is due, and does not catch up", async () => {
  const posed = await isolate(h);
  assertEqual(posed.run.spawnTimer, 0, "the fresh run's spawn timer");
  await h.skip(HELD_TICKS);
  const held = await h.snapshot();
  assertLength(held.run.enemies, 0, `spawns over ${HELD_TICKS} held ticks`);

  await h.debug.setSpawning(true);
  const seen = await captureReplay(h, "resumed", () => h.stepWatching(INTERVAL_TICKS));

  assertLength(seen[0]!.run.enemies, 1, "spawns on the first tick with the switch back on");
  for (let frame = 2; frame <= INTERVAL_TICKS; frame += 1) {
    assertLength(
      seen[frame - 1]!.run.enemies,
      1,
      `spawns by tick ${frame} after the switch returned, before the next interval`,
    );
  }
});
