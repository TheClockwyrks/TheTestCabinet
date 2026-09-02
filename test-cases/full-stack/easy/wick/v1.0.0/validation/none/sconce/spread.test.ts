// Wick — sconce/spread: sconces spread by `SCONCE_SPREAD`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): "Amount `n`
// launches `n` sconces on the same tick, sconce `i` counted from `0` with its
// direction rotated by `(i − (n − 1) / 2) × SCONCE_SPREAD` degrees, with
// `SCONCE_SPREAD` (`20`)", the direction being the launch direction `d`, "the
// direction of the nearest enemy on the tick of firing"; ("The nearest enemy")
// "Angles are in degrees, with `0` along `+x` and positive angles turning
// toward `+y`". Row 2 of `SCONCE_LEVELS` has amount `2`, so the two sconces
// leave at the direction toward the nearest enemy rotated by `-10` and `+10`
// degrees.
//
// WHAT IS READ. The angle of each sconce's velocity, against the angle from
// the lamplighter's center to the moth's center read off the state the tick
// launched from, `±10`: the specification counts the sconces by `i` without
// fixing which id each takes, so the two angles are sorted and compared as a
// pair rather than by id.
//
// WHY THE WORLD IS POSED AS IT IS. The requirement is the angle between the
// launches, so the night holds one moth and nothing else: one alive enemy
// makes the nearest enemy, and `d`, unambiguous. It stands at `(300, 400)`,
// `500` units out along `53.13` degrees, so neither rotated direction crosses
// the `0/360` seam and the two angles sort cleanly, and `500` is beyond the
// whole reach of a sconce, so neither is ever hit. Every switch but
// `weaponFire` is held, so the moth stands where it was posed and each sconce
// stands at the center with the velocity the launch gave it.
//
// TOLERANCE. `ANGLE_TOL` on each angle, recovered from a velocity through
// `atan2`; the two directions are `20` degrees apart and an unrotated sconce
// `10` from either.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertEqual } from "../assert";
import { ANGLE_TOL, SCONCE_SPREAD, weaponRow } from "../constants";
import {
  angleFrom,
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { SCONCE, sconcesOf } from "./stage";

/** The row of two sconces: `SCONCE_LEVELS` row 2. */
const LEVEL = 2;

/** The row's amount, `2`. */
const AMOUNT = weaponRow(SCONCE, LEVEL).amount!;

/** The one moth: `500` from the origin along `53.13` degrees. */
const MOTH = { x: 300, y: 400 };

/** The rotations the formula gives sconce `i`: `(i − (n − 1) / 2) × SCONCE_SPREAD`. */
const ROTATIONS = Array.from(
  { length: AMOUNT },
  (_, i) => (i - (AMOUNT - 1) / 2) * SCONCE_SPREAD,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("launches two level-2 sconces at the direction toward the moth rotated by -10 and +10 degrees", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const firing = await fireWeapon(h, SCONCE, LEVEL);
  await captureStill(h, "spread");

  const sconces = sconcesOf(firing);
  assertEqual(
    sconces.length,
    AMOUNT,
    `Sconce projectiles the level-${LEVEL} launch tick created`,
  );
  const toward = angleFrom(firing.before.run.player, MOTH);
  const angles = sconces
    .map((sconce) => angleFrom({ x: 0, y: 0 }, { x: sconce.vx, y: sconce.vy }))
    .sort((a, b) => a - b);
  for (const [index, rotation] of ROTATIONS.entries()) {
    assertAngleNear(
      angles[index]!,
      toward + rotation,
      ANGLE_TOL,
      `the ${index}th smallest sconce angle, the direction toward the moth rotated by ${rotation} degrees`,
    );
  }
});
