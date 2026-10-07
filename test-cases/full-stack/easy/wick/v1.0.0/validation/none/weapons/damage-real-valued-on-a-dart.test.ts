// Wick — weapons/damage-real-valued-on-a-dart: a posed Pin dart carries the
// table damage times `damageMul` unrounded, and the enemy it hits loses exactly
// that.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Hits and death"):
// "Damage per hit is the table damage times `damageMul`, a real number, and
// `hp` is real." `specs/passives.md` ("Damage"): "The result is a real number,
// and enemy health is a real number, so a hit removes exactly that amount", and
// "Every real-valued result is used as a real number; nothing here is
// rounded." `damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick`, with
// `WICK_DAMAGE_PER_LEVEL` `0.1`. So with Wick 1 a level-1 Pin dart (table `6`)
// carries `6.6` and takes a rat from `15` to `8.4`. The slash a firing creates
// is `weapons/damage-real-valued-on-a-slash`'s.
//
// WHY THIS FIGURE. `6.6` is FRACTIONAL, which is what makes the point read the
// rule it names rather than the multiplier. A build that truncates or rounds
// the damage at creation, or holds `hp` as an integer, lands on `6` or `7` and
// on `8` or `9`, each a whole unit or half a unit from what is asserted and
// thousands of times the tolerance. A pose whose product happened to be whole —
// `10 × 1.1` is exactly `11` in binary floating point — would pass a rounding
// build untouched.
//
// THE POSE. One isolated night: Wick 1, and a Pin dart posed on a rat's center
// with zero velocity, which `spawnProjectile` gives "that row's damage times
// the `damageMul` in force at the call", then the tick that hits. Every other
// faculty is held; the target stands well clear of the lamplighter.
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
  holdPassive,
  isolate,
  mustEnemy,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the rat stands, under the dart. */
const DART_RAT = { x: 100, y: 0 };

const RAT_HP = ENEMIES.rat.hp;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries 6 × 1.1 through a dart's hit unrounded", async () => {
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

  const hit = await h.step(1);
  await captureStill(h, "real");
  assertNear(
    mustEnemy(hit, rat.id).hp,
    RAT_HP - dartDamage,
    FLOAT_TOL,
    "the rat's hp after the dart's hit",
  );
});
