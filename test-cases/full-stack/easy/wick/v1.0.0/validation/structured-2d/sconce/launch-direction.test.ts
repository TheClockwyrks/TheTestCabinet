// sconce/launch-direction — a sconce launches toward the nearest enemy at
// speed, from the lamplighter's center, decelerating along that direction.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): "A sconce is
// a circle of `radius`, launched from the player's center at `speed` along the
// launch direction `d`, the direction of the nearest enemy on the tick of
// firing", its "velocity along `d` falls under a constant acceleration of
// `−SCONCE_DECEL` (`600`)", and "Its pierce is `INFINITE_PIERCE`" (`-1`).
// "The nearest enemy" (Common rules) makes `d` "the unit vector from the
// player's center to the enemy's center", so with the one moth at `(300, 400)`
// from the lamplighter's center `d` is exactly `(0.6, 0.8)`. Level 1's row
// gives `speed` 600 and "Speed, Pierce, Duration: table value, unchanged"
// (Derived stats), so the launch velocity is `600 × (0.6, 0.8)` =
// `(360, 480)` and the acceleration is `−600 × (0.6, 0.8)` = `(−360, −480)`.
//
// WHY THE LAUNCH IS READ AFTER THE FIRING TICK. `specs/world.md` ("One tick"),
// phase 5 creates a firing's projectiles "at the lamplighter's and the
// enemies' positions of this tick", and phase 6 has a new projectile "first
// moving on the next tick", so the snapshot after the firing tick holds the
// sconce at the launch point with the velocity the launch gave it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth, Sconce at
// level 1 with its timer at 0, `weaponFire` on and every other switch off, so
// nothing spawns a second enemy that could be nearer, no passive scales a
// figure, and `effectMotion` being off leaves the read velocity the launched
// one rather than one tick's deceleration. That level 1 launches exactly one
// sconce is `row-1`'s point; here the count is the precondition the direction
// is read under.
//
// THE TOLERANCE. `MOTION_EPS` on the position, the velocity, and the
// acceleration, each a unit vector scaled by a table value or a constant. A
// launch that took the facing direction instead points along `(1, 0)` and is
// 360 units per second away on `x` alone; one that missed the deceleration
// reads `(0, 0)` for the acceleration. The pierce is a whole number compared
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertPointNear } from "../assert";
import {
  INFINITE_PIERCE,
  MOTION_EPS,
  SCONCE_DECEL,
  SCONCE_LEVELS,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireSconce, LAUNCH_DIRECTION, TARGET_POSTS } from "./firing";

/** Level 1 of Sconce: speed 600, amount 1. */
const LEVEL = 1;
const ROW = SCONCE_LEVELS[LEVEL - 1];

/** The one moth, at `(300, 400)` from the lamplighter's center. */
const POSTS = TARGET_POSTS.slice(0, 1);

/** `speed × d`, the velocity the launch gives. */
const VELOCITY = {
  x: ROW.speed * LAUNCH_DIRECTION.x,
  y: ROW.speed * LAUNCH_DIRECTION.y,
};

/** `−SCONCE_DECEL × d`, the acceleration it falls under. */
const ACCELERATION = {
  x: -SCONCE_DECEL * LAUNCH_DIRECTION.x,
  y: -SCONCE_DECEL * LAUNCH_DIRECTION.y,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("launches the sconce from the player's center at 600 × (0.6, 0.8) with acceleration −600 × (0.6, 0.8)", async () => {
  const firing = await fireSconce(h, LEVEL, POSTS);
  captureStill(h, "launched");

  assertEqual(
    firing.sconces.length,
    1,
    "the sconces the level-1 firing tick created (specs/weapons.md, Sconce)",
  );
  const [sconce] = firing.sconces;
  assertEqual(sconce.weapon, "sconce", "the launched projectile's weapon");

  const { player } = firing.after.run;
  assertPointNear(
    sconce,
    { x: player.x, y: player.y },
    MOTION_EPS,
    "the sconce's center on the firing tick, against the lamplighter's center (specs/weapons.md, Sconce)",
  );
  assertPointNear(
    { x: sconce.vx, y: sconce.vy },
    VELOCITY,
    MOTION_EPS,
    "the sconce's velocity, against speed × the direction of the nearest enemy (specs/weapons.md, Sconce)",
  );
  assertPointNear(
    { x: sconce.ax, y: sconce.ay },
    ACCELERATION,
    MOTION_EPS,
    "the sconce's acceleration, against −SCONCE_DECEL × that direction (specs/weapons.md, Sconce)",
  );
  assertEqual(
    sconce.pierce,
    INFINITE_PIERCE,
    "the sconce's pierce (specs/weapons.md, Sconce)",
  );
});
