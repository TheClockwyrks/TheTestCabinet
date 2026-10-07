// Wick — weapons/damage-real-valued-on-a-slash: the slash a firing creates
// carries the table damage times `damageMul` unrounded, and the enemy it hits
// loses exactly that.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Hits and death"): "Damage per hit is the table
//     damage times `damageMul`, a real number, and `hp` is real."
//   - `specs/passives.md` ("The derived stats"): `damageMul = 1 +
//     WICK_DAMAGE_PER_LEVEL × wick`, with `WICK_DAMAGE_PER_LEVEL` `0.1`, and
//     "Every real-valued result is used as a real number; nothing here is
//     rounded." So Wick 3 gives `1.3`.
//   - `specs/weapons.md` ("Taper"): level-2 damage `15`, so a slash under
//     Wick 3 carries `19.5`. `specs/enemies.md`: a hound has HP `120`, so it
//     reads `100.5`.
//   - `specs/weapons.md` ("Derived stats"): a shape's damage is fixed "when it
//     is created", the slash on the tick Taper fires; ("Taper"): "Its near
//     vertical edge is at the player's `x`, it extends `width` in the facing
//     direction, and it is centered vertically on the player's `y`".
//
// WHY THIS FIGURE. `19.5` is FRACTIONAL, so a build that truncates or rounds
// the product, or holds hp as an integer, lands on `19` or `20` and on `100` or
// `101` and fails. Every Taper level-1 damage times any Wick multiplier is
// whole, so a level-2 row is what the reading needs, and a hound is posed
// rather than a rat because `120` hp outlasts the slash. A posed projectile is
// `weapons/damage-real-valued-on-a-dart`'s.
//
// THE POSE. One hound inside the slash on an isolated run, every switch off but
// `weaponFire`, so nothing but the slash's hit reaches the hound's hp.
//
// TOLERANCE. `FIGURE_TOLERANCE`: the product is formed from stated reals and a
// build may form it in either order.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE, TAPER_LEVELS, derived } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  enemyById,
  holdPassive,
  holdWeapon,
  isolate,
  present,
  spawnEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";

/** The enemy hit: hp 120, which outlasts the slash. */
const TYPE = "hound";

/** The level of Taper the check poses: table damage `15`, not `10`. */
const TAPER_LEVEL = 2;

/** The Wick level in force, and the damage it gives the slash. */
const SLASH_WICK = 3;
const SLASH_DAMAGE =
  TAPER_LEVELS[TAPER_LEVEL - 1].damage *
  derived.damageMul({ wick: SLASH_WICK });

/** Where the hound stands: inside the slash's rectangle along +x. */
const HOUND_DX = TAPER_LEVELS[TAPER_LEVEL - 1].width / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries 15 × 1.3 = 19.5 on a slash, and removes it as a real number", async () => {
  isolate(h);
  holdPassive(h, "wick", SLASH_WICK);
  const hound = spawnEnemyNear(h, TYPE, HOUND_DX, 0);
  const slot = holdWeapon(h, "taper", TAPER_LEVEL);
  armWeapon(h, slot);
  const after = await h.tick(1);
  captureStill(h, "real");

  const slashes = zonesOfKind(after, "slash").filter(
    (zone) => zone.weapon === "taper",
  );
  assertEqual(slashes.length, 1, "Taper slashes the firing tick created");
  assertWithin(
    slashes[0].damage,
    SLASH_DAMAGE,
    FIGURE_TOLERANCE,
    "the slash's damage under Wick 3",
  );
  const hit = present(
    enemyById(after, hound),
    "the hound after the slash's hit",
  );
  assertWithin(
    hit.hp,
    ENEMIES[TYPE].hp - SLASH_DAMAGE,
    FIGURE_TOLERANCE,
    "the hound's hp after the slash's hit",
  );
});
