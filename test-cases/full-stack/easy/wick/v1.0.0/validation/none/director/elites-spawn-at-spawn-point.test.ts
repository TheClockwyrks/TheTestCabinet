// director/elites-spawn-at-spawn-point — the three scripted elites arrive on
// the spawn ring.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events") names
// the point in each of the three rows — "| 2:00 | 120 | Mothwing spawns at a
// spawn point |", "| 7:30 | 450 | Owl spawns at a spawn point |", and
// "| 9:00 | 540 | The Dark spawns at a spawn point |" — and ("The spawn ring")
// fixes what a spawn point is: "A spawn point is `SPAWN_DISTANCE` (`760`) units
// from the lamplighter's center at an angle drawn uniformly from the seeded
// generator". The angle is drawn, so the distance is the whole of what the
// specification fixes and the whole of what is read. The reading is taken on
// the arrival's own tick, because specs/world.md ("One tick", phase 10) says an
// enemy spawned on a tick "sits at its spawn point and first moves on the next
// tick".
//
// WHY ALL THREE IN ONE POINT. This is one requirement — an elite event arrives
// on the ring — read at each of the three places the requirement applies, the
// way a symmetric bound is read at both of its ends. Which tick each fires on
// is `mothwing-2-00`, `owl-7-30` and `dark-9-00`.
//
// WHY THE FIELD IS CLEARED BETWEEN THEM. So the arrival read at each crossing
// is that crossing's; the earlier elites are outside the despawn rule and would
// otherwise still be standing, and `clearEnemies` "Removes every enemy, elites
// and the Dark included" and changes nothing else.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone, so
// the window timer's own spawns do not arrive on these ticks; `enemyMotion` is
// off, so the Dark, whose speed is 170, has not stepped toward the lamplighter
// before its distance is read; and the lamplighter stands at the origin
// throughout, so the ring is centered where the arrivals are measured against.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` a position is allowed. The distance
// is `cos` and `sin` of one angle scaled by 760, whose float error is around
// `1e-13`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { EVENTS, POSITION_TOL, SPAWN_DISTANCE } from "../constants";
import {
  captureStill,
  createHarness,
  distanceBetween,
  player,
  type Harness,
} from "../harness";
import { carryAcross, isolateForEvents } from "./events";

/** The three rows of `EVENTS` that spawn one enemy at a spawn point. */
const ELITE_EVENTS = EVENTS.filter((event) => event.kind !== "swarm");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns the mothwing, the owl and the Dark 760 units from the lamplighter", async () => {
  await isolateForEvents(h);

  for (const event of ELITE_EVENTS) {
    await h.debug.clearEnemies();
    const crossing = await carryAcross(h, event.tick);
    assertEqual(
      crossing.arrivals.length,
      1,
      `enemies the ${event.kind} event on tick ${event.tick} spawned`,
    );
    const arrival = crossing.arrivals[0]!;
    assertEqual(
      arrival.type,
      event.kind,
      `the type tick ${event.tick} spawned`,
    );
    assertNear(
      distanceBetween(arrival, player(crossing.fired)),
      SPAWN_DISTANCE,
      POSITION_TOL,
      `the ${event.kind}'s distance from the lamplighter on tick ${event.tick}`,
    );
  }

  await captureStill(h, "ring");
});
