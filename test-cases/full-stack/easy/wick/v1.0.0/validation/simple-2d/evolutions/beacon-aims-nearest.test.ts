// Wick — evolutions/beacon-aims-nearest: Beacon's bolt leaves the lamplighter's
// center toward the nearest enemy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Beacon"): "a circle of `radius` fired from the
//     player's center at `speed` toward the nearest enemy on the tick of
//     firing"; the fixed row has speed `500` and amount `1`.
//   - `specs/weapons.md` ("The nearest enemy"): "The nearest enemy is the live
//     enemy whose center is the smallest Euclidean distance from the player's
//     center", and "A direction toward an enemy is the unit vector from the
//     player's center to the enemy's center". A moth at `(300, 400)` from the
//     center is `500` away and a hound at `(0, −800)` is `800` away, so the
//     moth is the nearest, its unit vector is `(0.6, 0.8)`, and the bolt's
//     velocity is `500 × (0.6, 0.8)`, which is `(300, 400)`.
//   - `specs/world.md` ("One tick"), phase 5: a due weapon fires "creating its
//     projectiles and zones at the lamplighter's and the enemies' positions of
//     this tick"; phase 6: a new projectile is "first moving on the next tick",
//     so after the firing tick the bolt still carries its launch velocity.
//
// WHAT IS READ. Every Beacon bolt after the firing tick: its velocity against
// `(300, 400)`. Both components are asserted, so a build that aims at the
// farther enemy, along an axis, or at an enemy's edge fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Beacon alone with exactly two enemies at two
// distances in two directions, so the ordering has something to decide and the
// answer is told by direction alone; no passive held, so the speed is the fixed
// figure; every driver switch but `weaponFire` off, so `enemyMotion` holds both
// enemies where they were posed for the firing tick and `effectMotion` holds
// the bolt at its launch for the reading. Both enemies stand far beyond any
// overlap with a bolt created at the center.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each velocity component, the product of the
// stated speed and a quotient of stated figures read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { BEACON_STATS, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { armEvolved } from "./evolved";

/** The nearer enemy: a moth 500 units from the lamplighter's center. */
const NEAR = { type: "moth", dx: 300, dy: 400 } as const;

/** The farther enemy: a hound 800 units out, in another direction. */
const FAR = { type: "hound", dx: 0, dy: -800 } as const;

/** The unit vector toward the moth, `(300, 400) / 500`. */
const DIRECTION = { x: 0.6, y: 0.8 };

/** The fixed row's speed times that direction: `(300, 400)`. */
const EXPECTED = {
  vx: BEACON_STATS.speed * DIRECTION.x,
  vy: BEACON_STATS.speed * DIRECTION.y,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates the bolt with velocity 500 × (0.6, 0.8), toward the nearer moth", async () => {
  armEvolved(h, "beacon");
  spawnEnemyNear(h, NEAR.type, NEAR.dx, NEAR.dy);
  spawnEnemyNear(h, FAR.type, FAR.dx, FAR.dy);
  assertEqual(
    Math.hypot(NEAR.dx, NEAR.dy) < Math.hypot(FAR.dx, FAR.dy),
    true,
    "whether the moth is the nearer of the two",
  );

  const after = await h.tick(1);
  captureStill(h, "aimed");

  const bolts = projectilesOf(after, "beacon");
  assertGreaterThan(bolts.length, 0, "Beacon bolts after the firing tick");
  for (const bolt of bolts) {
    assertWithin(bolt.vx, EXPECTED.vx, FIGURE_TOLERANCE, `bolt ${bolt.id}: vx`);
    assertWithin(bolt.vy, EXPECTED.vy, FIGURE_TOLERANCE, `bolt ${bolt.id}: vy`);
  }
});
