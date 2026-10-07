// passives/damage-mul-on-evolved — `damageMul` applies to an evolved weapon's
// single stat row.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`: "The formulas apply to
// every weapon alike, base and evolved. An evolved weapon's single stat row
// passes through damageMul, cooldownMul, areaMul, and amountBonus exactly as a
// base weapon's table row does." `specs/evolutions.md` (Passives still apply)
// repeats it: "damage is the fixed damage times `damageMul`". `damageMul` is
// `1 + 0.1 × wick`, so `1.2` at Wick 2, and `BEACON_STATS` gives `damage` `20`
// (`specs/evolutions.md`, Beacon), so the bolt reads `24`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Wick 2 and Beacon,
// with one hound at `FAR_POST`, the enemy Beacon "needs at least one enemy to
// fire" at. Beacon replaces Ember in the loadout, so Ember is never held
// beside it (`specs/instrumentation.md`, `setWeapon`). `effectMotion` stays
// off, so the bolt holds its position at the lamplighter's center and reaches
// nothing; every other switch but `weaponFire` stays off, so the tick creates
// the bolt and nothing else.
//
// THE TOLERANCE. `REAL_EPS` on the damage, one fixed figure times one
// multiplier; the unscaled figure, `20`, is four units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BEACON_STATS, REAL_EPS, damageMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { FAR_POST, fireUnder } from "./firing";

/** The Wick level held: `damageMul` `1.2`. */
const WICK = 2;

/** The damage Beacon's fixed `20` becomes under Wick 2: `24`. */
const DAMAGE = BEACON_STATS.damage * damageMul(WICK);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives Beacon's bolt damage 24 under Wick 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["wick", WICK]],
    weapons: [["beacon", 1]],
    enemies: [["hound", FAR_POST]],
  });
  captureStill(h, "evolved");

  const bolts = firing.projectiles.filter((p) => p.weapon === "beacon");
  assertEqual(
    bolts.length,
    BEACON_STATS.amount,
    "the bolts the firing tick created (specs/evolutions.md, Beacon)",
  );
  assertNear(
    bolts[0].damage,
    DAMAGE,
    REAL_EPS,
    "Beacon's bolt damage under Wick 2 (specs/passives.md, Damage)",
  );
});
