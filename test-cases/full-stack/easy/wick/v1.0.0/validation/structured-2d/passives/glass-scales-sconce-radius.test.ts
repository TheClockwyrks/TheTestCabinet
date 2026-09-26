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
import { SCONCE_LEVELS, REAL_EPS, areaMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { FAR_POST, fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** The radius the level-1 row's `12` becomes under Glass 2: `14.4`. */
const EXPECTED = SCONCE_LEVELS[0].radius * areaMul(GLASS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 sconce radius 14.4 under Glass 2", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["sconce", 1]],
    enemies: [["hound", FAR_POST]],
  });
  captureStill(h, "sconce");

  const shots = firing.projectiles.filter((p) => p.weapon === "sconce");
  assertEqual(
    shots.length,
    SCONCE_LEVELS[0].amount,
    "the shots the firing tick created (specs/weapons.md)",
  );
  assertNear(
    shots[0].radius,
    EXPECTED,
    REAL_EPS,
    "the sconce's radius under Glass 2 (specs/passives.md, Area)",
  );
});
