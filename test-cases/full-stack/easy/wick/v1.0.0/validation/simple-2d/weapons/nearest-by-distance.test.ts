// Wick — weapons/nearest-by-distance: the nearest enemy is the one whose
// center is the smallest Euclidean distance from the player's center.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("The nearest enemy"): "The nearest enemy is the live
//     enemy whose center is the smallest Euclidean distance from the player's
//     center ... A direction toward an enemy is the unit vector from the
//     player's center to the enemy's center".
//   - `specs/weapons.md` ("Ember"): "A bolt is a circle of `radius`, fired
//     from the player's center at `speed` in the direction of the nearest
//     enemy's center on the tick of firing", so the bolt's velocity is `speed`
//     times that unit vector.
//   - `specs/weapons.md` ("Cooldown timers"): a weapon with its timer at `0`
//     fires on the next `playing` tick, and `specs/instrumentation.md`:
//     "`setWeaponCooldown(slot, 0)` makes that the next tick".
//   - `specs/world.md` ("One tick"), phase 6: a projectile created this tick
//     hits at the position it was created at and "first moving on the next
//     tick", so after the firing tick the bolt is still at the player's center
//     with its launch velocity.
//
// WHAT IS READ. The direction of every Ember bolt after the firing tick. A
// moth stands 200 units along +x and a hound 150 units along -y: the hound's
// center is nearer, so the bolt's velocity is along -y. A build measuring to an
// enemy's edge agrees here too (190 against 132), so what separates a
// conformant build is only whether it aims at the nearer center at all rather
// than, say, the first enemy spawned or the one along the facing direction:
// the moth is spawned first AND lies along `facing`, so either mistake sends
// the bolt along +x.
//
// WHY THE NIGHT IS POSED AS IT IS. Two enemies and Ember alone, every switch
// off but `weaponFire`: `enemyMotion` off holds both where they were posed, so
// the distances the firing tick reads are the posed ones. The bolt is created
// at the origin, overlapping neither enemy, so it hits nothing on its firing
// tick and is still in `projectiles` to read.
//
// TOLERANCE. `DIRECTION_TOLERANCE` on each component of the bolt's unit
// velocity: the expected direction is the exact `(0, -1)`, and a build
// normalizes with `Math.hypot` or its own equivalent.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
import { DIRECTION_TOLERANCE } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  projectilesOf,
  spawnEnemyNear,
  unit,
  type Harness,
} from "../harness";

/** The farther enemy, spawned first and along the facing direction. */
const MOTH_DX = 200;

/** The nearer enemy, straight up: center distance 150 against the moth's 200. */
const HOUND_DY = -150;

/** The direction the bolt must leave along: toward the hound's center. */
const EXPECTED = { x: 0, y: -1 };

/**
 * Ticks of `effectMotion` run AFTER the reading, for the still alone: the bolt
 * leaves the lamplighter along its aim, so the picture shows where it went.
 * The assertions read the firing tick, and nothing here reaches them.
 */
const FLIGHT_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the Ember bolt toward the hound, the smaller center distance", async () => {
  isolate(h);
  spawnEnemyNear(h, "moth", MOTH_DX, 0);
  spawnEnemyNear(h, "hound", 0, HOUND_DY);
  const slot = holdWeapon(h, "ember", 1);
  armWeapon(h, slot);

  const after = await h.tick(1);
  enable(h, "effectMotion");
  await h.tick(FLIGHT_TICKS);
  captureStill(h, "nearest");

  const bolts = projectilesOf(after, "ember");
  assertGreaterThan(bolts.length, 0, "Ember bolts after the firing tick");
  for (const bolt of bolts) {
    const direction = unit(bolt.vx, bolt.vy);
    assertWithin(
      direction.x,
      EXPECTED.x,
      DIRECTION_TOLERANCE,
      `bolt ${bolt.id}: x of its unit velocity`,
    );
    assertWithin(
      direction.y,
      EXPECTED.y,
      DIRECTION_TOLERANCE,
      `bolt ${bolt.id}: y of its unit velocity`,
    );
  }
});
