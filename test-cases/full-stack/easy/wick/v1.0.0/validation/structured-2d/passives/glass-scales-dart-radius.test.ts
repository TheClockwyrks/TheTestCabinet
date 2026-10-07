// Wick — passives/glass-scales-dart-radius: `areaMul` scales a dart's
// collision radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "`areaMul`
// scales every length a weapon's table or stat row gives for the shape it hits
// with. The scaled length is the table value times `areaMul`, and a
// projectile's collision radius is a scaled length like any other", the table
// naming "Ember, Pin, Beacon, Hail | bolt `radius`" among them, over "`areaMul
// = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL` (`0.1`).
// Row 1 of `PIN_LEVELS` (`specs/weapons.md`) carries radius `6`, so with Glass
// at level 2 the dart reads `7.2`. The other radius the same table row covers
// is `passives/glass-scales-bolt-radius`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive`, and the
// weapon held at level 1 and fired by one tick. It fires "whether or not any
// enemy exists", so no enemy is posed. Every other faculty stays held, so
// nothing travels and nothing else fires: the reading is the projectile the
// tick created.
//
// TOLERANCE. `FLOAT_TOL` on the radius, a table figure times exactly `1.2`.
// The unscaled `6` is more than a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { PIN_LEVELS, REAL_EPS, areaMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** The radius the level-1 row's `6` becomes under Glass 2: `7.2`. */
const EXPECTED = PIN_LEVELS[0].radius * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 dart radius 7.2 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["pin", 1]],
  });
  captureStill(h, "dart");

  const shots = firing.projectiles.filter((p) => p.weapon === "pin");
  assertEqual(
    shots.length,
    PIN_LEVELS[0].amount,
    "the shots the firing tick created (specs/weapons.md)",
  );
  assertNear(
    shots[0].radius,
    EXPECTED,
    REAL_EPS,
    "the dart's radius under Glass 2 (specs/passives.md, Area)",
  );
});
