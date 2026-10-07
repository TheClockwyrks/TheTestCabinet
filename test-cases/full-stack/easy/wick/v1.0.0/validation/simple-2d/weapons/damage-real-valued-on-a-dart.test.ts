// Wick — weapons/damage-real-valued-on-a-dart: a posed Pin dart carries the
// table damage times `damageMul` unrounded, and the enemy it hits loses exactly
// that.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Hits and death"): "Damage per hit is the table
//     damage times `damageMul`, a real number, and `hp` is real."
//   - `specs/passives.md` ("The derived stats"): `damageMul = 1 +
//     WICK_DAMAGE_PER_LEVEL × wick`, with `WICK_DAMAGE_PER_LEVEL` `0.1`, and
//     "Every real-valued result is used as a real number; nothing here is
//     rounded." So Wick 1 gives `1.1`.
//   - `specs/weapons.md` ("Pin"): level-1 damage `6`, so a dart under Wick 1
//     carries `6.6`. `specs/enemies.md`: a rat has HP `15`, so it reads `8.4`.
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed dart's `damage`
//     is "that row's damage times the `damageMul` in force at the call".
//
// WHY THIS FIGURE. `6.6` is FRACTIONAL, so a build that truncates or rounds the
// product, or holds hp as an integer, lands on `6` or `7` and on `8` or `9` and
// fails. A whole product such as `10 × 1.1` would pass a rounding build
// untouched. The slash a firing creates is
// `weapons/damage-real-valued-on-a-slash`'s.
//
// THE POSE. One rat and one dart on an isolated run, every switch off, so
// nothing but the dart's hit reaches the rat's hp.
//
// TOLERANCE. `FIGURE_TOLERANCE`: `6 × 1.1` is not an exact double and a build
// may form the product in either order, so 1e-9 reads the product as the spec's
// real number.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE, PIN_LEVELS, derived } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  holdPassive,
  isolate,
  present,
  projectileById,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** The enemy hit: hp 15. */
const TYPE = "rat";

/** The Wick level in force, and the damage it gives the dart. */
const DART_WICK = 1;
const DART_DAMAGE =
  PIN_LEVELS[0].damage * derived.damageMul({ wick: DART_WICK });

/** Where the rat stands: along +x, clear of the lamplighter. */
const RAT_DX = 150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries 6 × 1.1 = 6.6 on a dart, and removes it as a real number", async () => {
  isolate(h);
  holdPassive(h, "wick", DART_WICK);
  const rat = spawnEnemyNear(h, TYPE, RAT_DX, 0);
  const posedRat = present(enemyById(h.snapshot(), rat), "the posed rat");
  const dart = spawnProjectileAt(h, "pin", posedRat.x, posedRat.y, 0, 0, 0);
  const posedDart = present(
    projectileById(h.snapshot(), dart),
    "the posed dart",
  );
  assertWithin(
    posedDart.damage,
    DART_DAMAGE,
    FIGURE_TOLERANCE,
    "the dart's damage under Wick 1",
  );

  const hit = present(
    enemyById(await h.tick(1), rat),
    "the rat after the dart's hit",
  );
  captureStill(h, "real");
  assertWithin(
    hit.hp,
    ENEMIES[TYPE].hp - DART_DAMAGE,
    FIGURE_TOLERANCE,
    "the rat's hp after the dart's hit",
  );
});
