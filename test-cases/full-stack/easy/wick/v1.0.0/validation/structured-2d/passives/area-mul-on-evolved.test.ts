// passives/area-mul-on-evolved — `areaMul` applies to an evolved weapon's
// single stat row.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`: "An evolved weapon's
// single stat row passes through damageMul, cooldownMul, areaMul, and
// amountBonus exactly as a base weapon's table row does", over the Area rule
// "The scaled length is the table value times `areaMul`, and a projectile's
// collision radius is a scaled length like any other" with the row "Ember,
// Pin, Beacon, Hail | bolt `radius`". `areaMul` is `1 + 0.1 × glass`, so `1.2`
// at Glass 2, and `HAIL_STATS` gives `radius` `7` (`specs/evolutions.md`,
// Hail), so each dart reads `8.4`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 2 and Hail
// alone. Hail replaces Pin, so Pin is never held beside it, and Hail is "fired
// whether or not any enemy exists", so the world holds no enemy at all. Its
// fixed row's `amount` is `6`, and every one of the six darts is read, so a
// build that scaled one and not the rest fails. `effectMotion` stays off, so
// none of them travels, and every other switch but `weaponFire` stays off.
//
// THE TOLERANCE. `REAL_EPS` on each radius, one fixed figure times one
// multiplier; the unscaled figure, `7`, is 1.4 units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HAIL_STATS, REAL_EPS, areaMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** The radius Hail's fixed `7` becomes under Glass 2: `8.4`. */
const RADIUS = HAIL_STATS.radius * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives every Hail dart radius 8.4 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["hail", 1]],
  });
  captureStill(h, "evolved");

  const darts = firing.projectiles.filter((p) => p.weapon === "hail");
  assertEqual(
    darts.length,
    HAIL_STATS.amount,
    "the darts the firing tick created (specs/evolutions.md, Hail)",
  );
  darts.forEach((dart, i) => {
    assertNear(
      dart.radius,
      RADIUS,
      REAL_EPS,
      `dart ${i}: radius under Glass 2 (specs/passives.md, Area)`,
    );
  });
});
