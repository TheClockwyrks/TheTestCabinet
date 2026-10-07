// director/cap-room-spawns-at-once — the first tick with room spawns.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The spawn timer"): "When
// the cap is full the timer rests at `0`, and the next spawn lands on the first
// tick that has room." The timer's own rule is what makes that true: "spawnTimer
// counts down; if spawnTimer is due and aliveCommons < cap: spawn one enemy",
// with a timer at `0` due on every tick until it is set again
// (specs/world.md — "Timers": "a timer at `0` stays due on every tick until it
// is set again"). Row 0 of `SPAWN_WINDOWS` reads
// "| 0 | 0:00 | moth | 1.00 | 20 |", so the cap is 20.
//
// WHAT THE READING SEPARATES. A build that lets the cap SET the timer as well
// as hold it — that starts a fresh interval when room appears — waits 60 ticks
// and fails, because the tick right after the removal is the one read. A build
// that counted the timer down while the cap was full and left it below zero, or
// that stopped counting altogether, is caught by the same tick.
//
// WHY THE TIMER IS RESTED FIRST, AND FOR AN INTERVAL AND A HALF. The cap is
// posed full and ninety ticks are run before the removal, so the timer is at
// rest under the cap rather than merely posed there, which is the state the
// sentence quoted above describes. The odd half is what makes the reading
// decide the point: a build that sets a fresh interval on the ticks the cap
// held is mid-count when the room appears and spawns nothing, where a build
// that rested at `0` spawns on that very tick. Ninety ticks is also a whole
// number of ticks of the row's interval, `round(1.00 × 1.5 × TICK_HZ)`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone; the
// twenty moths stand well outside the ring, and `enemyMotion`, `enemyContact`
// and `despawning` are off, so the only thing that changes the count is the one
// removal. `removeEnemy` "Removes enemy `id`. Nothing drops, nothing counts as
// a kill, and no cue plays" (specs/instrumentation.md), so it changes the count
// and nothing else.
//
// THE TOLERANCE. Whole counts, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPAWN_WINDOWS, dueTicks } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  placeEnemy,
  type EnemyView,
  type Harness,
} from "../harness";

/** Row 0's cap and interval. */
const ROW = SPAWN_WINDOWS[0]!;

/** An interval and a half of row 0, run to leave the timer at rest under the cap. */
const REST_TICKS = dueTicks(ROW.interval * 1.5);

/** Where the posed commons stand: well outside the spawn ring. */
const FILLER_X = 2000;

/** The gap between them, so no two share a point. */
const FILLER_GAP = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns on the very tick a removal makes room under the cap", async () => {
  await isolate(h, { on: ["spawning"] });
  const held: EnemyView[] = [];
  for (let at = 0; at < ROW.cap; at += 1) {
    held.push(await placeEnemy(h, "moth", FILLER_X + at * FILLER_GAP, 0));
  }
  await h.debug.setSpawnTimer(0);
  const resting = await h.step(REST_TICKS);
  assertEqual(
    resting.run.aliveCommons,
    ROW.cap,
    `aliveCommons after ${REST_TICKS} ticks at the cap`,
  );

  await h.debug.removeEnemy(held[0]!.id);
  const before = await h.snapshot();
  const after = await h.step(1);
  await captureStill(h, "room");

  assertEqual(
    before.run.aliveCommons,
    ROW.cap - 1,
    "aliveCommons after one moth is removed",
  );
  assertEqual(
    newEnemies(before, after).length,
    1,
    "enemies the first tick with room spawned",
  );
});
