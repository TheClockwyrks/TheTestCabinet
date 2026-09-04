// passives/glass-scales-puddle-radius — Glass scales a puddle's radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area, gives the row
// "Oil Splash, Blaze | puddle `radius`" over "The scaled length is the table
// value times `areaMul`", and `areaMul` is `1 + 0.1 × glass`, so `1.2` at
// Glass 2. Oil Splash's level-1 row gives `radius` `50`
// (`specs/weapons.md`, Oil Splash), so the puddle reads `60`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 2 and Oil
// Splash at level 1 alone. Oil Splash "fires whether or not any enemy exists",
// so the world holds no enemy and the puddle's pulse hits nothing; where the
// puddle lands is a draw of the game's generator and is `spreads-and-ranges-
// fixed`'s point, not this one's. Every driver switch but `weaponFire` stays
// off.
//
// THE TOLERANCE. `REAL_EPS` on the radius, one table figure times one
// multiplier; the unscaled figure, `50`, is ten units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { OIL_SPLASH_LEVELS, REAL_EPS, areaMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** Oil Splash's level-1 row, whose `radius` is `50`. */
const ROW = OIL_SPLASH_LEVELS[0];

/** The radius the row's `50` becomes under Glass 2: `60`. */
const RADIUS = ROW.radius * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 Oil Splash puddle radius 60 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["oil-splash", 1]],
  });
  captureStill(h, "puddle");

  const puddles = firing.zones.filter((zone) => zone.kind === "puddle");
  assertEqual(
    puddles.length,
    ROW.amount,
    "the puddles the firing tick created (specs/weapons.md, Oil Splash)",
  );
  assertNear(
    puddles[0].radius,
    RADIUS,
    REAL_EPS,
    "the puddle's radius under Glass 2 (specs/passives.md, Area)",
  );
});
