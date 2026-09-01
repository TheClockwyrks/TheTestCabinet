// Wick — passives/glass-scales-bolt-radius: `areaMul` scales a bolt's and a
// dart's collision radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "`areaMul`
// scales every length a weapon's table or stat row gives for the shape it hits
// with. The scaled length is the table value times `areaMul`, and a
// projectile's collision radius is a scaled length like any other", the table
// naming "Ember, Pin, Beacon, Hail | bolt `radius`", over
// "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL`
// (`0.1`). Row 1 of `EMBER_LEVELS` carries radius `8` and row 1 of
// `PIN_LEVELS` carries radius `6` (`specs/weapons.md`), so with Glass at level
// 2 a bolt reads `9.6` and a dart reads `7.2`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive`, and Ember
// and Pin held at level 1 and fired by one tick together. Ember "needs at least
// one enemy to fire", so one hound stands `FAR` (`5000`) units along `+x`, past
// every reach a bolt has; Pin fires "whether or not any enemy exists". Every
// other faculty stays held, so nothing travels and nothing else fires: the
// reading is the two projectiles the tick created.
//
// TOLERANCE. `FLOAT_TOL` on each radius, a table figure times exactly `1.2`.
// The unscaled `8` and `6` are more than a unit from either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, areaMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { fireVolley, placeFarTarget, shotsOf } from "./stage";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The level both weapons are held at. */
const LEVEL = 1;

/** The scale every length the rows give passes through. */
const SCALE = areaMul({ glass: GLASS_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads radius 9.6 on a level-1 Ember bolt and 7.2 on a level-1 Pin dart with Glass 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  await placeFarTarget(h, "hound");

  const volley = await fireVolley(h, [
    { id: "ember", level: LEVEL },
    { id: "pin", level: LEVEL },
  ]);
  await captureStill(h, "bolt");

  const bolts = shotsOf(volley, "ember");
  assertEqual(bolts.length, 1, "Ember bolts the firing tick created");
  assertNear(
    bolts[0]!.radius,
    (weaponRow("ember", LEVEL).radius ?? NaN) * SCALE,
    FLOAT_TOL,
    "the bolt's radius with Glass 2 held",
  );

  const darts = shotsOf(volley, "pin");
  assertEqual(darts.length, 1, "Pin darts the firing tick created");
  assertNear(
    darts[0]!.radius,
    (weaponRow("pin", LEVEL).radius ?? NaN) * SCALE,
    FLOAT_TOL,
    "the dart's radius with Glass 2 held",
  );
});
