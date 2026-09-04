// Wick — clock/spawn-sits-on-spawn-tick: an enemy the director spawns on a tick
// sits at its spawn point that tick and first moves on the next.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick"), phase 10: "The spawn director ... An enemy
//     spawned on this tick sits at its spawn point and first moves on the next
//     tick."
//   - `specs/enemies.md` ("The spawn ring"): "A spawn point is
//     `SPAWN_DISTANCE` (`760`) units from the lamplighter's center"; ("The
//     spawn timer"): "`spawnTimer` ... is set to `0` when a run starts ... A
//     spawn therefore lands on the first tick of a run"; ("Windows"): window 0
//     spawns moths at an interval of 1 s, so no second spawn lands on tick 2.
//   - `specs/enemies.md` ("Chase"): "Each tick a chasing enemy recomputes its
//     heading as the unit vector from its center to the lamplighter's center
//     and advances one step along it", one step being `speed * TICK_DT`, and a
//     moth's speed is `100`.
//
// WHAT IS READ. With `spawning` and `enemyMotion` on and nothing else, the
// first tick of the run is the director's first spawn: tick 1's snapshot must
// hold one enemy at exactly `SPAWN_DISTANCE` from the lamplighter, where the
// enemy would already be one step closer had it moved on its spawn tick. Tick
// 2's snapshot must hold it one step closer, `100 × TICK_DT` nearer, which is
// the move that was deferred.
//
// WHY THE NIGHT IS POSED AS IT IS. The director is the thing under test, so it
// runs; the enemy's motion runs so that "first moves on the next tick" is
// readable as a change of distance. Nothing else is switched on, no weapon is
// held, and the lamplighter stands still, so the distance changes by the moth's
// own step alone.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the spawn distance, a stated figure
// through a cosine and a sine; `MOTION_TOLERANCE` (1e-6) on the distance after
// one step, a position integrated by one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  MOTION_TOLERANCE,
  SPAWN_DISTANCE,
  TICK_DT,
} from "../constants";
import {
  captureReplay,
  createHarness,
  distance,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** Ticks recorded after the reading, so the evidence shows the moth closing. */
const AFTERMATH_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts a director spawn at SPAWN_DISTANCE on its tick and moves it on the next", async () => {
  isolate(h);
  enable(h, "spawning", "enemyMotion");

  const outcome = await captureReplay(h, "spawned", async () => {
    const spawnTick = await h.tick(1);
    const nextTick = await h.tick(1);
    await h.tick(AFTERMATH_TICKS);
    return { spawnTick, nextTick };
  });

  assertEqual(
    outcome.spawnTick.run.enemies.length,
    1,
    "enemies on the run's first tick, the director's first spawn",
  );
  const spawned = outcome.spawnTick.run.enemies[0];
  assertWithin(
    distance(spawned, outcome.spawnTick.run.player),
    SPAWN_DISTANCE,
    FIGURE_TOLERANCE,
    "distance from the lamplighter on the spawn tick",
  );

  const moved = outcome.nextTick.run.enemies.find(
    (enemy) => enemy.id === spawned.id,
  );
  assertEqual(moved !== undefined, true, "the spawn still alive a tick later");
  assertWithin(
    distance(moved ?? spawned, outcome.nextTick.run.player),
    SPAWN_DISTANCE - ENEMIES[spawned.type].speed * TICK_DT,
    MOTION_TOLERANCE,
    "distance from the lamplighter on the tick after the spawn",
  );
});
