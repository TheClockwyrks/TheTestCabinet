// director/spawn-ring-distance — every window spawn arrives exactly
// `SPAWN_DISTANCE` from the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The spawn ring"): "A spawn
// point is `SPAWN_DISTANCE` (`760`) units from the lamplighter's center at an
// angle drawn uniformly over the full circle: `x = player.x + cos(angle) *
// SPAWN_DISTANCE`, `y = player.y + sin(angle) * SPAWN_DISTANCE`". Whatever
// angle the draw gives, the distance is the same figure every time, which is
// what this reads. The reading is taken on the spawn's own tick, because
// specs/world.md ("One tick", phase 10) says "An enemy spawned on this tick
// sits at its spawn point and first moves on the next tick", so the spawn tick
// is the tick the ring's radius is still the enemy's distance.
//
// WHY FIVE SPAWNS. Row 0 of `SPAWN_WINDOWS` spawns one enemy every
// `round(1.00 × TICK_HZ)` ticks up to twenty alive, so five spawns take 300
// ticks, stay inside window 0 (ticks 0 to 1799) and never reach the cap. Five
// draws of the angle is what makes this "every spawn" rather than one: a build
// that placed its first spawn on the ring and the rest anywhere fails here.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone.
// `enemyMotion` is off, so nothing that arrived on an earlier tick can drift
// and be mistaken for a spawn off the ring; the lamplighter stands at the
// origin and never moves, so the ring is centered where the spawns are read
// against.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` a position is allowed. The
// distance is `cos` and `sin` of one angle scaled by 760, whose float error is
// around `1e-13`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  POSITION_TOL,
  SPAWN_DISTANCE,
  SPAWN_WINDOWS,
  dueTicks,
} from "../constants";
import {
  captureStill,
  createHarness,
  distanceBetween,
  isolate,
  newEnemies,
  player,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** How many spawns the check reads. */
const SPAWNS = 5;

/** The ticks five spawns of row 0 take: five whole intervals. */
const SPAN_TICKS = dueTicks(SPAWN_WINDOWS[0]!.interval) * SPAWNS;

/** One spawn, with the tick it landed on and its distance from the lamplighter. */
interface Arrival {
  tick: number;
  distance: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands every spawn exactly 760 units from the lamplighter", async () => {
  await isolate(h, { on: ["spawning"] });
  await h.debug.setSpawnTimer(0);

  const arrivals: Arrival[] = [];
  let previous: WickSnapshot = await h.snapshot();
  for (let tick = 1; tick <= SPAN_TICKS; tick += 1) {
    const after = await h.step(1);
    for (const arrival of newEnemies(previous, after)) {
      arrivals.push({
        tick: after.run.tick,
        distance: distanceBetween(arrival, player(after)),
      });
    }
    previous = after;
  }
  await captureStill(h, "ring");

  assertEqual(
    arrivals.length,
    SPAWNS,
    `spawns across ${SPAN_TICKS} ticks of window 0`,
  );
  for (const arrival of arrivals) {
    assertNear(
      arrival.distance,
      SPAWN_DISTANCE,
      POSITION_TOL,
      `the distance from the lamplighter of the spawn on tick ${arrival.tick}`,
    );
  }
});
