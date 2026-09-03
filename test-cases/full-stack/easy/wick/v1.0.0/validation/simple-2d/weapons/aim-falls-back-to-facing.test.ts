// Wick — weapons/aim-falls-back-to-facing: aiming at an enemy whose center
// coincides with the player's uses the facing direction.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("The nearest enemy"): "A direction toward an enemy is
//     the unit vector from the player's center to the enemy's center, and when
//     the two centers coincide the facing direction is used instead. The
//     facing direction is `facing` from `specs/world.md`: `+x` for `"right"`
//     and `-x` for `"left"`."
//   - `specs/weapons.md` ("Ember"): the bolt is "fired from the player's
//     center at `speed` in the direction of the nearest enemy's center", and
//     "Its pierce is the table `pierce`", `1` at level 5.
//   - `specs/world.md` ("One tick"), phase 6: a new projectile hits "at the
//     position it was created at" on its firing tick. The bolt is created ON
//     the coincident enemy, so it hits on that tick; with pierce `1` the hit
//     lowers pierce to `0` rather than removing it ("Projectiles and pierce"),
//     which is why Ember is held at level 5 and not level 1, whose pierce-0
//     bolt would be spent by that same hit and leave nothing to read.
//   - `specs/instrumentation.md` (`setFacing`): sets `facing`.
//
// WHAT IS READ. The direction of every Ember bolt after the firing tick, with
// the one enemy posed exactly on the player's center and `facing` posed
// `"left"`. The bolt must leave along -x. Facing is posed LEFT rather than left
// at the fresh run's `"right"`, so a build that falls back to a fixed +x, or to
// a zero vector, fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One hound and Ember alone, every switch off
// but `weaponFire`. A hound (hp 120) survives the level-5 bolt's 15 damage, so
// no death, drop, or kill is added to the tick. `enemyContact` is off, so the
// coincident hound lands no hit of its own. `effectMotion` is off, so the bolt
// holds its launch velocity for the reading, as it would anyway before its
// first move.
//
// TOLERANCE. `DIRECTION_TOLERANCE` on each component of the bolt's unit
// velocity, against the exact `(-1, 0)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { DIRECTION_TOLERANCE, EMBER_LEVELS } from "../constants";
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

/** The lowest Ember level whose bolt survives one hit: pierce 1. */
const EMBER_LEVEL = EMBER_LEVELS.findIndex((row) => row.pierce >= 1) + 1;

/** The direction the bolt must leave along: `facing` `"left"`, -x. */
const EXPECTED = { x: -1, y: 0 };

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

it("fires the Ember bolt along -x at a coincident enemy while facing left", async () => {
  isolate(h);
  h.debug.setFacing("left");
  spawnEnemyNear(h, "hound", 0, 0);
  const slot = holdWeapon(h, "ember", EMBER_LEVEL);
  const posed = h.snapshot();
  assertEqual(posed.run.player.facing, "left", "facing before the tick");
  armWeapon(h, slot);

  const after = await h.tick(1);
  enable(h, "effectMotion");
  await h.tick(FLIGHT_TICKS);
  captureStill(h, "facing");

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
