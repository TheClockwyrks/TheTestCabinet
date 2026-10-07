// Wick — passives/area-mul-on-evolved: an evolved weapon's fixed lengths pass
// through `areaMul` as a table row does.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`: "The formulas apply to
// every weapon alike, base and evolved. An evolved weapon's single stat row
// passes through damageMul, cooldownMul, areaMul, and amountBonus exactly as a
// base weapon's table row does", over
// "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL`
// (`0.1`), the table naming "Ember, Pin, Beacon, Hail | bolt `radius`".
// `specs/evolutions.md` ("Passives still apply") repeats it: "every width,
// height, radius, and orbit is the fixed length times `areaMul`". `HAIL_STATS`
// carries radius `7` and amount `6`, so with Glass at level 2 each of the six
// darts reads `7 × 1.2 = 8.4`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive` and Hail
// held at its single level and fired by one tick. Hail is "fired whether or not
// any enemy exists", so no enemy is posed, and every other faculty stays held,
// so nothing travels and nothing else fires.
//
// TOLERANCE. `FLOAT_TOL` on each radius, a fixed figure times exactly `1.2`.
// The unscaled `7` is more than a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, areaMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The fixed row read: radius `7`, amount `6`. */
const ROW = weaponRow("hail");

/** `7 × (1 + 0.1 × 2)`. */
const EXPECTED = (ROW.radius ?? NaN) * areaMul({ glass: GLASS_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads radius 8.4 on every Hail dart with Glass 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);

  const firing = await fireWeapon(h, "hail");
  await captureStill(h, "evolved");

  const darts = firing.projectiles.filter((shot) => shot.weapon === "hail");
  assertEqual(darts.length, ROW.amount, "Hail darts the firing tick created");
  for (const dart of darts) {
    assertNear(
      dart.radius,
      EXPECTED,
      FLOAT_TOL,
      `dart ${dart.id}'s radius with Glass 2 held`,
    );
  }
});
