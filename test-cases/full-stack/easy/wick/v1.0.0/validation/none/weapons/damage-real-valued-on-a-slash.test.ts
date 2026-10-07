// Wick — weapons/damage-real-valued-on-a-slash: the slash a firing creates
// carries the table damage times `damageMul` unrounded, and the enemy it hits
// loses exactly that.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Hits and death"):
// "Damage per hit is the table damage times `damageMul`, a real number, and
// `hp` is real." `specs/passives.md` ("Damage"): "The result is a real number,
// and enemy health is a real number, so a hit removes exactly that amount", and
// "Every real-valued result is used as a real number; nothing here is
// rounded." With Wick 3 a level-2 Taper slash (table `15`) carries `19.5` and
// takes a hound from `120` to `100.5`. A posed projectile is
// `weapons/damage-real-valued-on-a-dart`'s.
//
// WHY THIS FIGURE. `19.5` is FRACTIONAL, which is what makes the point read the
// rule it names rather than the multiplier. A build that truncates or rounds
// the damage at creation, or holds `hp` as an integer, lands on `19` or `20`
// and on `100` or `101`, each half a unit or more from what is asserted and
// thousands of times the tolerance. Every Taper level-1 damage times any Wick
// multiplier is whole, so a level-2 row is what the reading needs.
//
// THE POSE. One isolated night: Wick 3, a hound inside Taper's level-2 slash
// (`120` wide from the player's `x` in the facing direction, `40` tall centered
// on the player's `y`), and the tick Taper fires. A hound is posed rather than
// a rat because `120` hp outlasts the slash and leaves a fractional reading to
// take. The slash zone stays in the snapshot for `SLASH_FLASH`, so its damage
// is read off the same tick.
//
// TOLERANCE. `FLOAT_TOL`: the product is formed from stated reals and a build
// may multiply in either order; the nearest whole figures are half a unit away
// or more.

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
  type Harness,
} from "../harness";

/** The level of Taper the check poses: table damage `15`, not `10`. */
const TAPER_LEVEL = 2;

/**
 * Where the hound stands: halfway along the level-2 slash, which reaches from
 * the player's `x` to `x + 120` and spans `y ± 20` facing right.
 */
const SLASH_HOUND = { x: weaponRow("taper", TAPER_LEVEL).width! / 2, y: 0 };

const HOUND_HP = ENEMIES.hound.hp;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries 15 × 1.3 through a slash's hit unrounded", async () => {
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
