// Wick — halo/ignores-amount: Halo ignores amount, so Mirror adds no second
// aura and no second helping of damage.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): "one zone of
// kind `aura`" and "Amount is ignored"; ("Amount") "A weapon's amount is the
// table amount plus `amountBonus` ... Halo and Flare ignore amount".
// `specs/passives.md` ("Amount"): "Halo, Corona, and Flare have no amount and
// ignore `amountBonus`", with `amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`,
// `2` at Mirror 2. Row 1 of `HALO_LEVELS` carries damage `3`, and a moth
// spawns with `5` hp at a run clock of `0` (`specs/enemies.md`). So with
// Mirror 2 held the first tick Halo is held leaves exactly one aura and the
// moth at `2`: the row's damage removed once.
//
// THE POSE. An isolated night with Mirror held at level 2, one moth `40` along
// `+x` from the lamplighter, inside the `80 + 10` at which its circle and the
// aura overlap, then Halo held at level 1 and its first tick run through the
// shared `fireWeapon` (held, due, `weaponFire` on, one tick): "Halo pulses on
// the first `playing` tick it is held". `enemyMotion` and `enemyContact` stay
// held, so the moth stands where it was posed and hits nothing back.
//
// TOLERANCE. `FLOAT_TOL` on the moth's hp: `5 − 3 × 1` is exact, and a build
// that pulsed it once per amount would read `−4`. The aura count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  mustEnemy,
  type Harness,
} from "../harness";
import { HALO, aurasOf, placeTarget } from "./stage";

/** The level whose row is held: damage `3`. */
const LEVEL = 1;

/** Halo's level-1 damage, `3`, from `HALO_LEVELS`. */
const DAMAGE = weaponRow(HALO, LEVEL).damage;

/** Mirror's level, the passive's maximum: `amountBonus` `2`. */
const MIRROR_LEVEL = 2;

/** A moth's table hp, `5`, unscaled at tick `0`. */
const MOTH_HP = ENEMIES.moth.hp;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds one aura and removes 3 once from an overlapping moth on the first pulse with Mirror 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "mirror", MIRROR_LEVEL);
  const moth = await placeTarget(h, "moth");
  assertEqual(moth.hp, MOTH_HP, "the moth's hp as posed");

  const firing = await fireWeapon(h, HALO, LEVEL);
  await captureStill(h, "one");

  const auras = aurasOf(firing.after);
  assertEqual(
    auras.length,
    1,
    `auras on the first tick Halo is held with Mirror ${MIRROR_LEVEL}`,
  );
  assertEqual(auras[0]!.weapon, HALO, "the aura's weapon");
  assertNear(
    mustEnemy(firing.after, moth.id).hp,
    MOTH_HP - DAMAGE,
    FLOAT_TOL,
    `the moth's hp on the first pulse with Mirror ${MIRROR_LEVEL} held`,
  );
});
