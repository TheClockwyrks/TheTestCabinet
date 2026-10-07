// Wick — passives/glass-scales-sconce-radius: `areaMul` scales a sconce's
// collision radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "`areaMul`
// scales every length a weapon's table or stat row gives for the shape it hits
// with. The scaled length is the table value times `areaMul`, and a
// projectile's collision radius is a scaled length like any other", the table
// naming "Shard, Sconce | bolt `radius`" among them, over "`areaMul = 1 +
// GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL` (`0.1`). Row 1 of
// `SCONCE_LEVELS` (`specs/weapons.md`) carries radius `12`, so with Glass at
// level 2 the sconce reads `14.4`. The other radius the same table row covers
// is `passives/glass-scales-shard-radius`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive`, and the
// weapon held at level 1 and fired by one tick. It "needs at least one enemy
// to fire", so one hound stands `FAR` (`5000`) units along `+x`, past every
// reach the shape has. Every other faculty stays held, so nothing travels and
// nothing else fires: the reading is the projectile the tick created.
//
// TOLERANCE. `FLOAT_TOL` on the radius, a table figure times exactly `1.2`.
// The unscaled `12` is more than a unit away.

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

/** The level the weapon is held at. */
const LEVEL = 1;

/** The scale every length the row gives passes through. */
const SCALE = areaMul({ glass: GLASS_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads radius 14.4 on a level-1 sconce with Glass 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  await placeFarTarget(h, "hound");

  const volley = await fireVolley(h, [{ id: "sconce", level: LEVEL }]);
  await captureStill(h, "sconce");

  const shots = shotsOf(volley, "sconce");
  assertEqual(shots.length, 1, "shots the firing tick created");
  assertNear(
    shots[0]!.radius,
    (weaponRow("sconce", LEVEL).radius ?? NaN) * SCALE,
    FLOAT_TOL,
    "the sconce's radius with Glass 2 held",
  );
});
