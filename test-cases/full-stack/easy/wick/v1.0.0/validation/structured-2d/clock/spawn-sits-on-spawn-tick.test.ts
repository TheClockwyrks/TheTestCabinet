// Wick — clock/spawn-sits-on-spawn-tick: an enemy spawned on a tick sits at
// its spawn point that tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick", phase 10): "the spawn timer while
//     `spawning` is on. An enemy spawned on this tick sits at its spawn point
//     and first moves on the next tick."
//   - `specs/enemies.md` ("The spawn ring"): "A spawn point is
//     `SPAWN_DISTANCE` (`760`) units from the lamplighter's center at an angle
//     drawn uniformly over the full circle".
//   - `specs/enemies.md` ("The spawn timer"): "A spawn therefore lands on the
//     first tick of a run"; and `specs/state.md`: `spawnTimer` "is `0` when a
//     run starts". Window 0 offers `moth` alone, interval 1.00 s, cap 20.
//   - `specs/enemies.md` ("Chase"): "Each tick a chasing enemy recomputes its
//     heading as the unit vector from its center to the lamplighter's center
//     and advances one step along it", one step being `speed × TICK_DT`, and a
//     moth's speed is 100.
//
// THE DRIVE. An isolated run with `spawning` and `enemyMotion` on and every
// other switch off, the timer at `0`. Tick 1 is the director's first spawn:
// one moth appears, and in that tick's snapshot its center is exactly
// `SPAWN_DISTANCE` from the lamplighter, because it has not moved. On tick 2
// it takes its first step, straight toward the lamplighter, so the distance
// is `SPAWN_DISTANCE − 100 × TICK_DT`. A build that moves a spawn on its spawn
// tick reads the shorter distance a tick early.
//
// TOLERANCE. `REAL_EPS` on the spawn tick's distance: `760` placed by a cosine
// and a sine and read back through a hypotenuse rounds by ulps. `MOTION_EPS`
// on the next tick's, one integration step on top.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import {
  ENEMIES,
  MOTION_EPS,
  REAL_EPS,
  SPAWN_DISTANCE,
  TICK_DT,
} from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  distance,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** One step of the moth window 0 spawns. */
const MOTH_STEP = ENEMIES.moth.speed * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads a director spawn at SPAWN_DISTANCE on its spawn tick and one step in on the next", async () => {
  const posed = isolate(h);
  h.debug.setSpawnTimer(0);
  enable(h, "spawning", "enemyMotion");

  const spawned = await captureReplay(h, "spawned", async () => {
    const onSpawnTick = await advanceTicks(h, 1);
    const nextTick = await advanceTicks(h, 1);
    return { onSpawnTick, nextTick };
  });

  assertEqual(
    spawned.onSpawnTick.run.enemies.length,
    1,
    `the enemies the director spawned on tick ${posed.run.tick + 1}`,
  );
  const spawn = spawned.onSpawnTick.run.enemies[0];
  assertNear(
    distance(spawn, spawned.onSpawnTick.run.player),
    SPAWN_DISTANCE,
    REAL_EPS,
    "the spawn's distance from the lamplighter in its spawn tick's snapshot",
  );

  const moved = spawned.nextTick.run.enemies.find((e) => e.id === spawn.id);
  assertDefined(moved, "the spawn still alive on the next tick");
  assertNear(
    distance(moved ?? spawn, spawned.nextTick.run.player),
    SPAWN_DISTANCE - MOTH_STEP,
    MOTION_EPS,
    "the spawn's distance from the lamplighter after its first move, on tick n + 1",
  );
});
