// passives/glass-scales-bolt-radius — Glass scales a bolt's and a dart's
// radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area: "`areaMul` scales
// every length a weapon's table or stat row gives for the shape it hits with.
// The scaled length is the table value times `areaMul`, and a projectile's
// collision radius is a scaled length like any other", with the rows "Ember,
// Pin, Beacon, Hail | bolt `radius`". `areaMul` is `1 + 0.1 × glass`, so `1.2`
// at Glass 2. Ember's level-1 row gives `radius` `8` and Pin's gives `6`
// (`specs/weapons.md`), so the bolt reads `9.6` and the dart `7.2`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 2, Ember at
// level 1, and Pin at level 1, with one hound at `FAR_POST`, the enemy Ember
// "needs at least one enemy to fire" at; Pin "fires whether or not any enemy
// exists". `effectMotion` stays off, so neither projectile travels and neither
// reaches the hound nine hundred units away, and every other switch but
// `weaponFire` stays off, so the tick creates the two shapes and nothing else.
//
// THE TOLERANCE. `REAL_EPS` on each radius, one table figure times one
// multiplier; the unscaled figures, `8` and `6`, are more than a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { EMBER_LEVELS, PIN_LEVELS, REAL_EPS, areaMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { FAR_POST, fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** The radius Ember's level-1 `8` becomes under Glass 2: `9.6`. */
const BOLT = EMBER_LEVELS[0].radius * areaMul(GLASS);

/** The radius Pin's level-1 `6` becomes under Glass 2: `7.2`. */
const DART = PIN_LEVELS[0].radius * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 Ember bolt radius 9.6 and a level-1 Pin dart radius 7.2 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [
      ["ember", 1],
      ["pin", 1],
    ],
    enemies: [["hound", FAR_POST]],
  });
  captureStill(h, "bolt");

  const bolts = firing.projectiles.filter((p) => p.weapon === "ember");
  const darts = firing.projectiles.filter((p) => p.weapon === "pin");
  assertEqual(
    bolts.length,
    EMBER_LEVELS[0].amount,
    "the bolts the firing tick created (specs/weapons.md, Ember)",
  );
  assertEqual(
    darts.length,
    PIN_LEVELS[0].amount,
    "the darts the firing tick created (specs/weapons.md, Pin)",
  );
  assertNear(
    bolts[0].radius,
    BOLT,
    REAL_EPS,
    "the bolt's radius under Glass 2 (specs/passives.md, Area)",
  );
  assertNear(
    darts[0].radius,
    DART,
    REAL_EPS,
    "the dart's radius under Glass 2 (specs/passives.md, Area)",
  );
});
