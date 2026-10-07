// Wick — weapons/nearest-tie-lowest-id: a distance tie goes to the lowest
// enemy id.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("The nearest enemy"): "The nearest enemy is the live
//     enemy whose center is the smallest Euclidean distance from the player's
//     center, ties broken by the lowest enemy `id`."
//   - `specs/weapons.md` ("Ember"): the bolt is "fired from the player's
//     center at `speed` in the direction of the nearest enemy's center on the
//     tick of firing".
//   - `specs/enemies.md` ("The life of an enemy"): "An enemy spawns with the
//     next id from `nextId`, so ids ascend in spawn order", and
//     `specs/instrumentation.md`: a posed enemy "takes the next id".
//   - `specs/world.md` ("One tick"), phase 6: a new projectile first moves on
//     the next tick, so after the firing tick the bolt still carries its launch
//     velocity.
//
// WHAT IS READ. The direction of every Ember bolt after the firing tick. Two
// moths stand exactly 200 units away, one along +y and one along +x, and the
// one along +y is spawned FIRST so it holds the lower id. The bolt must leave
// along +y. The moth along +x lies on the facing direction, so a build that
// breaks the tie toward `facing`, or toward the higher id, sends the bolt along
// +x and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Two moths and Ember alone, every switch off
// but `weaponFire`, so nothing moves and the tie the firing tick reads is the
// posed one. Both distances are the exact integer 200, so no rounding can
// break the tie for the build.
//
// TOLERANCE. `DIRECTION_TOLERANCE` on each component of the bolt's unit
// velocity, against the exact `(0, 1)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan, assertWithin } from "../assert";
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

/** Both moths stand exactly this far from the player's center. */
const DISTANCE = 200;

/** The direction the bolt must leave along: toward the lower-id moth, +y. */
const EXPECTED = { x: 0, y: 1 };

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

it("fires the Ember bolt toward the tied moth with the lower id", async () => {
  isolate(h);
  const lower = spawnEnemyNear(h, "moth", 0, DISTANCE);
  const higher = spawnEnemyNear(h, "moth", DISTANCE, 0);
  assertLessThan(lower, higher, "the +y moth's id against the +x moth's");
  const slot = holdWeapon(h, "ember", 1);
  armWeapon(h, slot);

  const after = await h.tick(1);
  enable(h, "effectMotion");
  await h.tick(FLIGHT_TICKS);
  captureStill(h, "tie");

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
