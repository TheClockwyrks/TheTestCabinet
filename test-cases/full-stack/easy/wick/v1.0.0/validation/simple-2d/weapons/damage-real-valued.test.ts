// Wick — weapons/damage-real-valued: damage per hit and health are real
// numbers, the table damage times `damageMul` with nothing rounded.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Hits and death"): "Damage per hit is the table
//     damage times `damageMul`, a real number, and `hp` is real."
//   - `specs/passives.md` ("The derived stats"): `damageMul = 1 +
//     WICK_DAMAGE_PER_LEVEL × wick`, with `WICK_DAMAGE_PER_LEVEL` `0.1`, and
//     "Every real-valued result is used as a real number; nothing here is
//     rounded." So Wick 1 gives `1.1` and Wick 3 gives `1.3`.
//   - `specs/weapons.md` ("Ember"): level-1 damage `10`, so a bolt under Wick 1
//     carries `11`; ("Taper"): level-1 damage `10`, width `120`, height `40`,
//     so a slash under Wick 3 carries `13`. `specs/enemies.md`: a rat has HP
//     `15`, radius `12`.
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed bolt's `damage`
//     is "that row's damage times the `damageMul` in force at the call", and
//     `specs/weapons.md` ("Derived stats"): a shape's damage is fixed "when it
//     is created", the slash on the tick Taper fires.
//   - `specs/weapons.md` ("Taper"): "Its near vertical edge is at the player's
//     `x`, it extends `width` in the facing direction, and it is centered
//     vertically on the player's `y`", so a rat 60 units along +x of a
//     right-facing lamplighter is inside the slash.
//
// WHAT IS READ. Two scenes. Under Wick 1, a posed level-1 Ember bolt reads
// damage `11` and the rat it hits reads hp `4`. Under Wick 3, the slash Taper
// fires reads damage `13` and the rat it hits reads hp `2`. A build that
// rounds the multiplier, truncates the product, or stores hp as an integer
// misses one of the four.
//
// WHY THE NIGHT IS POSED AS IT IS. One rat and one shape per scene, every
// switch off but `weaponFire` in the Taper scene, so nothing but the shape's
// hit reaches the rat's hp. Each scene is posed on its own isolated run so the
// Wick level in force is exactly the one the scene names.
//
// TOLERANCE. `FIGURE_TOLERANCE`: `10 × 1.1` and `10 × 1.3` are not exact
// doubles and a build may form the product in either order, so 1e-9 reads the
// product as the spec's real number.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
import {
  EMBER_LEVELS,
  ENEMIES,
  FIGURE_TOLERANCE,
  TAPER_LEVELS,
  derived,
} from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  enemyById,
  holdPassive,
  holdWeapon,
  isolate,
  present,
  projectileById,
  spawnEnemyNear,
  spawnProjectileAt,
  zonesOfKind,
  type Harness,
} from "../harness";

/** The enemy hit in both scenes: hp 15. */
const TYPE = "rat";

/** The Wick level of the bolt scene, and the damage it gives the bolt. */
const BOLT_WICK = 1;
const BOLT_DAMAGE =
  EMBER_LEVELS[0].damage * derived.damageMul({ wick: BOLT_WICK });

/** The Wick level of the slash scene, and the damage it gives the slash. */
const SLASH_WICK = 3;
const SLASH_DAMAGE =
  TAPER_LEVELS[0].damage * derived.damageMul({ wick: SLASH_WICK });

/** Where the bolt scene's rat stands: along +x, clear of the lamplighter. */
const BOLT_RAT_DX = 150;

/** Where the slash scene's rat stands: inside the 120-wide slash along +x. */
const SLASH_RAT_DX = TAPER_LEVELS[0].width / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries 10 × 1.1 = 11 on a bolt and 10 × 1.3 = 13 on a slash, and removes each as a real number", async () => {
  // The bolt scene, under Wick 1.
  isolate(h);
  holdPassive(h, "wick", BOLT_WICK);
  const boltRat = spawnEnemyNear(h, TYPE, BOLT_RAT_DX, 0);
  const boltRatPosed = present(
    enemyById(h.snapshot(), boltRat),
    "the bolt scene's rat",
  );
  const bolt = spawnProjectileAt(
    h,
    "ember",
    boltRatPosed.x,
    boltRatPosed.y,
    0,
    0,
    0,
  );
  const boltPosed = present(
    projectileById(h.snapshot(), bolt),
    "the posed bolt",
  );
  assertWithin(
    boltPosed.damage,
    BOLT_DAMAGE,
    FIGURE_TOLERANCE,
    "the bolt's damage under Wick 1",
  );
  const boltHit = present(
    enemyById(await h.tick(1), boltRat),
    "the rat after the bolt's hit",
  );
  assertWithin(
    boltHit.hp,
    ENEMIES[TYPE].hp - BOLT_DAMAGE,
    FIGURE_TOLERANCE,
    "the rat's hp after the bolt's hit",
  );

  // The slash scene, under Wick 3.
  isolate(h);
  holdPassive(h, "wick", SLASH_WICK);
  const slashRat = spawnEnemyNear(h, TYPE, SLASH_RAT_DX, 0);
  const slot = holdWeapon(h, "taper", 1);
  armWeapon(h, slot);
  const after = await h.tick(1);
  captureStill(h, "real");

  const slashes = zonesOfKind(after, "slash").filter(
    (zone) => zone.weapon === "taper",
  );
  assertGreaterThan(slashes.length, 0, "Taper slashes after the firing tick");
  for (const slash of slashes) {
    assertWithin(
      slash.damage,
      SLASH_DAMAGE,
      FIGURE_TOLERANCE,
      `slash ${slash.id}: damage under Wick 3`,
    );
  }
  const slashHit = present(
    enemyById(after, slashRat),
    "the rat after the slash's hit",
  );
  assertWithin(
    slashHit.hp,
    ENEMIES[TYPE].hp - SLASH_DAMAGE,
    FIGURE_TOLERANCE,
    "the rat's hp after the slash's hit",
  );
});
