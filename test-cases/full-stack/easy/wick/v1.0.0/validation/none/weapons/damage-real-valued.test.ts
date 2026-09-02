// Wick — weapons/damage-real-valued: damage and health are real numbers.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Hits and death"):
// "Damage per hit is the table damage times `damageMul`, a real number, and
// `hp` is real." `specs/passives.md` ("Damage"): "The result is a real number,
// and enemy health is a real number, so a hit removes exactly that amount", and
// "Every real-valued result is used as a real number; nothing here is
// rounded." `damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick`, with
// `WICK_DAMAGE_PER_LEVEL` `0.1`. So with Wick 1 a level-1 Pin dart (table `6`)
// carries `6.6` and takes a rat from `15` to `8.4`; with Wick 3 a level-2 Taper
// slash (table `15`) carries `19.5` and takes a hound from `120` to `100.5`.
//
// WHY THESE FOUR FIGURES. Every one of them is FRACTIONAL, which is what makes
// the point read the rule it names rather than the multiplier. A build that
// truncates or rounds the damage at creation, or holds `hp` as an integer,
// lands on `6` or `7` and `8` or `9` on the first half and on `19` or `20` and
// `100` or `101` on the second, each a whole unit or half a unit from what is
// asserted and thousands of times the tolerance. A pose whose product happened
// to be whole — `10 × 1.1` is exactly `11` in binary floating point, and every
// Taper level-1 damage times any Wick multiplier is whole — would pass a
// rounding build untouched and leave `damageMul` the only thing under test,
// which is `passives`'s point rather than this one.
//
// THE POSE. Two halves of the same edge, in one isolated night each. First,
// Wick 1 and a Pin dart posed on a rat's center with zero velocity —
// `spawnProjectile` gives it "that row's damage times the `damageMul` in force
// at the call" — and the tick that hits. Then Wick 3, a hound inside Taper's
// level-2 slash (`120` wide from the player's `x` in the facing direction, `40`
// tall centered on the player's `y`), and the tick Taper fires; a hound is
// posed rather than a rat because `120` hp outlasts the slash and leaves a
// fractional reading to take. The slash zone stays in the snapshot for
// `SLASH_FLASH`, so its damage is read off the same tick. Every other faculty
// is held; the target stands well clear of the lamplighter.
//
// TOLERANCE. `FLOAT_TOL`: `6 × 1.1` is `6.6000000000000005` in binary floating
// point and a build may multiply in either order; the nearest whole figures are
// four tenths of a unit away or more.

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

/** The level of Taper the second half poses: table damage `15`, not `10`. */
const TAPER_LEVEL = 2;

/** Where the rat stands, under the dart. */
const DART_RAT = { x: 100, y: 0 };

/**
 * Where the hound stands: halfway along the level-2 slash, which reaches from
 * the player's `x` to `x + 120` and spans `y ± 20` facing right.
 */
const SLASH_HOUND = { x: weaponRow("taper", TAPER_LEVEL).width! / 2, y: 0 };

const RAT_HP = ENEMIES.rat.hp;
const HOUND_HP = ENEMIES.hound.hp;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries 6 × 1.1 and 15 × 1.3 through a hit unrounded", async () => {
  // Wick 1, Pin: damage 6.6, the rat to 8.4.
  await isolate(h);
  await holdPassive(h, "wick", 1);
  const dartDamage = weaponRow("pin", 1).damage * damageMul({ wick: 1 });
  const rat = await placeEnemy(h, "rat", DART_RAT.x, DART_RAT.y);
  assertEqual(rat.hp, RAT_HP, "the rat's hp as posed");
  const dart = await placeProjectile(h, "pin", DART_RAT.x, DART_RAT.y, 0, 0, 0);
  assertNear(
    dart.damage,
    dartDamage,
    FLOAT_TOL,
    "the dart's damage with Wick 1",
  );
  const dartHit = await h.step(1);
  assertNear(
    mustEnemy(dartHit, rat.id).hp,
    RAT_HP - dartDamage,
    FLOAT_TOL,
    "the rat's hp after the dart's hit",
  );

  // Wick 3, Taper at level 2: damage 19.5, the hound to 100.5.
  await isolate(h);
  await holdPassive(h, "wick", 3);
  const slashDamage =
    weaponRow("taper", TAPER_LEVEL).damage * damageMul({ wick: 3 });
  const hound = await placeEnemy(h, "hound", SLASH_HOUND.x, SLASH_HOUND.y);
  assertEqual(hound.hp, HOUND_HP, "the hound's hp as posed");
  const fired = await fireWeapon(h, "taper", TAPER_LEVEL);
  await captureStill(h, "real");
  const slashes = fired.zones.filter((zone) => zone.kind === "slash");
  assertEqual(slashes.length, 1, "slashes the level-2 firing created");
  assertNear(
    slashes[0]!.damage,
    slashDamage,
    FLOAT_TOL,
    "the slash's damage with Wick 3",
  );
  assertNear(
    mustEnemy(fired.after, hound.id).hp,
    HOUND_HP - slashDamage,
    FLOAT_TOL,
    "the hound's hp after the slash's hit",
  );
});
