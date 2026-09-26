// Wick — sconce/launch-direction: a sconce launches toward the nearest enemy
// at the row's speed, decelerating along that same direction.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): "A sconce is
// a circle of `radius`, launched from the player's center at `speed` along the
// launch direction `d`, the direction of the nearest enemy on the tick of
// firing ... Its velocity along `d` falls under a constant acceleration of
// `−SCONCE_DECEL` (`600`) units per second squared ... Its pierce is
// `INFINITE_PIERCE`"; ("The nearest enemy") "A direction toward an enemy is
// the unit vector from the player's center to the enemy's center". Row 1 of
// `SCONCE_LEVELS` launches at speed `600`. With the one moth at `(300, 400)`,
// `500` units from the lamplighter's center at the origin, `d` is
// `(0.6, 0.8)`, so the launch creates one sconce at the lamplighter's center
// with velocity `600 × (0.6, 0.8)`, acceleration `−600 × (0.6, 0.8)`, and
// pierce `-1`.
//
// WHY THE WORLD IS POSED AS IT IS. The requirement is where a sconce leaves
// from and which way it leaves, so the night holds one enemy and nothing else:
// with a single moth alive there is exactly one nearest enemy and `d` is
// unambiguous, and a `(300, 400)` target makes both components of `d` non-zero
// and distinct, so a build that swapped, dropped, or negated a component
// fails. Every switch but `weaponFire` is held, so the launch tick counts one
// timer and fires one weapon, the moth stands where it was posed, and the
// sconce stands at the center it was created at with the vectors the launch
// gave it. The moth is `500` out, beyond both a sconce's reach and the sum of
// the two radii, so nothing is hit on the launch tick or ever.
//
// TOLERANCE. `POSITION_TOL` on the launch point, a coordinate copied from the
// lamplighter's; `FLOAT_TOL` on each component of the velocity and the
// acceleration, each the speed or `SCONCE_DECEL` times a unit vector a build
// is free to normalize in whichever order it likes. The count and the pierce
// are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  FLOAT_TOL,
  INFINITE_PIERCE,
  POSITION_TOL,
  SCONCE_DECEL,
} from "../constants";
import {
  captureStill,
  createHarness,
  directionToward,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { LAUNCH_SPEED, SCONCE, sconcesOf } from "./stage";

/** The level whose row is held: speed `600`. */
const LEVEL = 1;

/** The one moth: `500` from the origin, so `d` is `(0.6, 0.8)`. */
const MOTH = { x: 300, y: 400 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("launches one sconce from the lamplighter's center at 600 toward the moth, decelerating along the same direction", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const firing = await fireWeapon(h, SCONCE, LEVEL);
  await captureStill(h, "launched");

  const sconces = sconcesOf(firing);
  assertEqual(sconces.length, 1, "Sconce projectiles the launch tick created");
  const sconce = sconces[0]!;
  const at = firing.before.run.player;
  const d = directionToward(firing.before, MOTH);

  assertNear(sconce.x, at.x, POSITION_TOL, "the sconce's x at the launch");
  assertNear(sconce.y, at.y, POSITION_TOL, "the sconce's y at the launch");
  assertNear(
    sconce.vx,
    LAUNCH_SPEED * d.x,
    FLOAT_TOL,
    "the sconce's velocity, x",
  );
  assertNear(
    sconce.vy,
    LAUNCH_SPEED * d.y,
    FLOAT_TOL,
    "the sconce's velocity, y",
  );
  assertNear(
    sconce.ax,
    -SCONCE_DECEL * d.x,
    FLOAT_TOL,
    "the sconce's acceleration, x",
  );
  assertNear(
    sconce.ay,
    -SCONCE_DECEL * d.y,
    FLOAT_TOL,
    "the sconce's acceleration, y",
  );
  assertEqual(sconce.pierce, INFINITE_PIERCE, "the sconce's pierce");
});
