// clock/spawn-sits-on-spawn-tick — an enemy the director spawns on a tick sits
// at its spawn point for that tick and first moves on the next.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick"), phase 10: "An
// enemy spawned on this tick sits at its spawn point and first moves on the
// next tick." specs/enemies.md ("The life of an enemy"): "an enemy spawned on a
// tick sits at its spawn point for that tick and first moves on the next"; and
// ("The spawn ring"): "A spawn point is `SPAWN_DISTANCE` (`760`) units from the
// lamplighter's center". The first spawn's tick is fixed too ("The spawn
// timer"): "It is set to `0` when a run starts ... A spawn therefore lands on
// the first tick of a run", of the type window 0 lists, `moth`. What that moth
// does on the tick after is ("Chase"): "Each tick a chasing enemy recomputes
// its heading as the unit vector from its center to the lamplighter's center
// and advances one step along it", a step of "`speed * TICK_DT` units", the
// moth's `speed` being `100`.
//
// THE DRIVE. An isolated run with `spawning` and `enemyMotion` on and the
// spawn timer posed to `0`. The first tick spawns; in that tick's snapshot the
// new enemy's distance from the lamplighter is exactly `SPAWN_DISTANCE`, which
// phase 4 of the same tick would already have shortened by a step had the
// spawn moved on the tick it arrived. The second tick moves it, and the
// distance is `SPAWN_DISTANCE` less one step of its own speed, straight in.
// The lamplighter stands still throughout.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` a position integrated on the tick
// is allowed, on distances the spawn point's `cos`/`sin` and one step's
// `speed × TICK_DT` carry to `1e-13`. The figure that separates a spawn that
// sat from one that moved is the step itself, `1.667` units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, POSITION_TOL, SPAWN_DISTANCE, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  distanceBetween,
  isolate,
  mustEnemy,
  newEnemies,
  player,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sits at SPAWN_DISTANCE on its spawn tick and takes its first step on the next", async () => {
  const posed = await isolate(h, { on: ["spawning", "enemyMotion"] });
  await h.debug.setSpawnTimer(0);
  const { spawned, moved } = await captureReplay(h, "spawned", async () => {
    const spawned = await h.step(1);
    const moved = await h.step(1);
    return { spawned, moved };
  });

  const arrivals = newEnemies(posed, spawned);
  assertEqual(
    arrivals.length,
    1,
    "enemies the director spawned on the run's first tick",
  );
  const arrival = arrivals[0]!;
  assertNear(
    distanceBetween(arrival, player(spawned)),
    SPAWN_DISTANCE,
    POSITION_TOL,
    "the spawn's distance from the lamplighter in its spawn tick's snapshot",
  );
  assertNear(
    distanceBetween(mustEnemy(moved, arrival.id), player(moved)),
    SPAWN_DISTANCE - ENEMIES[arrival.type].speed * TICK_DT,
    POSITION_TOL,
    "the spawn's distance from the lamplighter after the tick after its spawn tick",
  );
});
