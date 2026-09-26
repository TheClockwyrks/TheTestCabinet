// Wick — passives/glass-scales-bolt-radius: `areaMul` scales a bolt's
// collision radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "`areaMul`
// scales every length a weapon's table or stat row gives for the shape it hits
// with. The scaled length is the table value times `areaMul`, and a
// projectile's collision radius is a scaled length like any other", the table
// naming "Ember, Pin, Beacon, Hail | bolt `radius`" among them, over "`areaMul
// = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL` (`0.1`).
// Row 1 of `EMBER_LEVELS` (`specs/weapons.md`) carries radius `8`, so with
// Glass at level 2 the bolt reads `9.6`. The other radius the same table row
// covers is `passives/glass-scales-dart-radius`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive`, and the
// weapon held at level 1 and fired by one tick. It "needs at least one enemy
// to fire", so one hound stands `FAR` (`5000`) units along `+x`, past every
// reach the shape has. Every other faculty stays held, so nothing travels and
// nothing else fires: the reading is the projectile the tick created.
//
// TOLERANCE. `FLOAT_TOL` on the radius, a table figure times exactly `1.2`.
// The unscaled `8` is more than a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { EMBER_LEVELS, REAL_EPS, areaMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { FAR_POST, fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** The radius the level-1 row's `8` becomes under Glass 2: `9.6`. */
const EXPECTED = EMBER_LEVELS[0].radius * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 bolt radius 9.6 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["ember", 1]],
    enemies: [["hound", FAR_POST]],
  });
  captureStill(h, "bolt");

  const shots = firing.projectiles.filter((p) => p.weapon === "ember");
  assertEqual(
    shots.length,
    EMBER_LEVELS[0].amount,
    "the shots the firing tick created (specs/weapons.md)",
  );
  assertNear(
    shots[0].radius,
    EXPECTED,
    REAL_EPS,
    "the bolt's radius under Glass 2 (specs/passives.md, Area)",
  );
});
