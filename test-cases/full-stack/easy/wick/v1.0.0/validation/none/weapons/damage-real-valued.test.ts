// Wick — weapons/damage-real-valued: damage and health are real numbers.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Hits and death"):
// "Damage per hit is the table damage times `damageMul`, a real number, and
// `hp` is real." `specs/passives.md` ("Damage"): "The result is a real number,
// and enemy health is a real number, so a hit removes exactly that amount", and
// "Every real-valued result is used as a real number; nothing here is
// rounded." `damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick`, with
// `WICK_DAMAGE_PER_LEVEL` `0.1`. So with Wick 1 a level-1 Ember bolt (table
// `10`) carries `11` and takes a rat from `15` to `4`; with Wick 3 a level-1
// Taper slash (table `10`) carries `13` and takes a rat to `2`. Each figure
// falls between two whole numbers a rounding build would land on: a build that
// truncates or rounds damage, or keeps hp as an integer, reads `10` and `5`, or
// `13` and `2` by luck on one half and `11` and `4` by none on the other.
//
// THE POSE. Two halves of the same edge, in one isolated night each. First,
// Wick 1 and a bolt posed on a rat's center with zero velocity — `spawnProjectile`
// gives it "that row's damage times the `damageMul` in force at the call" — and
// the tick that hits. Then Wick 3, a rat inside Taper's level-1 slash (`120`
// wide from the player's `x` in the facing direction, `40` tall centered on
// the player's `y`), and the tick Taper fires. The slash zone stays in the
// snapshot for `SLASH_FLASH`, so its damage is read off the same tick. Every
// other faculty is held; the rat stands well clear of the lamplighter.
//
// TOLERANCE. `FLOAT_TOL`: `10 × 1.1` is `11.000000000000002` in binary floating
// point and a build may multiply in either order; the nearest whole figures
// are a whole unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, damageMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  mustEnemy,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the first rat stands, under the bolt. */
const BOLT_RAT = { x: 100, y: 0 };

/**
 * Where the second rat stands: halfway along the level-1 slash, which reaches
 * from the player's `x` to `x + 120` and spans `y ± 20` facing right.
 */
const SLASH_RAT = { x: weaponRow("taper", 1).width! / 2, y: 0 };

const RAT_HP = ENEMIES.rat.hp;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries 10 × 1.1 and 10 × 1.3 through a hit unrounded", async () => {
  // Wick 1, Ember: damage 11, the rat to 4.
  await isolate(h);
  await holdPassive(h, "wick", 1);
  const boltDamage = weaponRow("ember", 1).damage * damageMul({ wick: 1 });
  const firstRat = await placeEnemy(h, "rat", BOLT_RAT.x, BOLT_RAT.y);
  assertEqual(firstRat.hp, RAT_HP, "the first rat's hp as posed");
  const bolt = await placeProjectile(
    h,
    "ember",
    BOLT_RAT.x,
    BOLT_RAT.y,
    0,
    0,
    0,
  );
  assertNear(
    bolt.damage,
    boltDamage,
    FLOAT_TOL,
    "the bolt's damage with Wick 1",
  );
  const boltHit = await h.step(1);
  assertNear(
    mustEnemy(boltHit, firstRat.id).hp,
    RAT_HP - boltDamage,
    FLOAT_TOL,
    "the first rat's hp after the bolt's hit",
  );

  // Wick 3, Taper: damage 13, the rat to 2.
  await isolate(h);
  await holdPassive(h, "wick", 3);
  const slashDamage = weaponRow("taper", 1).damage * damageMul({ wick: 3 });
  const secondRat = await placeEnemy(h, "rat", SLASH_RAT.x, SLASH_RAT.y);
  assertEqual(secondRat.hp, RAT_HP, "the second rat's hp as posed");
  const fired = await fireWeapon(h, "taper", 1);
  await captureStill(h, "real");
  const slashes = fired.zones.filter((zone) => zone.kind === "slash");
  assertEqual(slashes.length, 1, "slashes the level-1 firing created");
  assertNear(
    slashes[0]!.damage,
    slashDamage,
    FLOAT_TOL,
    "the slash's damage with Wick 3",
  );
  assertNear(
    mustEnemy(fired.after, secondRat.id).hp,
    RAT_HP - slashDamage,
    FLOAT_TOL,
    "the second rat's hp after the slash's hit",
  );
});
