// Wick — passives/glass-scales-puddle-radius: `areaMul` scales a puddle's
// radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): the table names
// "Oil Splash, Blaze | puddle `radius`" among the lengths `areaMul` scales,
// over "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with
// `GLASS_AREA_PER_LEVEL` (`0.1`). Row 1 of `OIL_SPLASH_LEVELS`
// (`specs/weapons.md`) carries radius `50` and amount `1`, so with Glass at
// level 2 the one puddle reads `60`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive` and Oil
// Splash held at level 1 and fired by one tick. Oil Splash "fires whether or
// not any enemy exists", so no enemy is posed; the puddle lands at a random
// point of the scatter disk, which the reading does not touch. Every other
// faculty stays held, so nothing else fires and nothing moves.
//
// TOLERANCE. `FLOAT_TOL` on the radius, a table figure times exactly `1.2`. The
// unscaled `50` is ten units away.

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

/** The Oil Splash level fired: table radius `50`, amount `1`. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads radius 60 on a level-1 Oil Splash puddle with Glass 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);

  const firing = await fireWeapon(h, "oil-splash", LEVEL);
  await captureStill(h, "puddle");

  const puddles = firing.zones.filter((zone) => zone.weapon === "oil-splash");
  assertEqual(puddles.length, 1, "puddles the firing tick created");
  assertNear(
    puddles[0]!.radius,
    (weaponRow("oil-splash", LEVEL).radius ?? NaN) *
      areaMul({ glass: GLASS_LEVEL }),
    FLOAT_TOL,
    "the puddle's radius with Glass 2 held",
  );
});
