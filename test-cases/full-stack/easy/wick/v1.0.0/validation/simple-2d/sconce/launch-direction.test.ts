// Wick — sconce/launch-direction: the sconce leaves the lamplighter's center
// toward the nearest enemy, at speed and with its deceleration pointing back
// along the launch direction.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Sconce"): "A sconce is a circle of `radius`,
//     launched from the player's center at `speed` along the launch direction
//     `d`, the direction of the nearest enemy on the tick of firing", "Its
//     velocity along `d` falls under a constant acceleration of
//     `−SCONCE_DECEL` (`600`) units per second squared", and "Its pierce is
//     `INFINITE_PIERCE`". The level-1 row has speed `600`.
//   - `specs/weapons.md` ("The nearest enemy"): "A direction toward an enemy
//     is the unit vector from the player's center to the enemy's center". A
//     moth at `(300, 400)` from the center is `500` away, so `d` is
//     `(0.6, 0.8)`, the velocity is `600 × (0.6, 0.8)`, which is `(360, 480)`,
//     and the acceleration is `-600 × (0.6, 0.8)`, which is `(-360, -480)`.
//   - `specs/state.md` (`ProjectileState`, `ax`, `ay`): "Every projectile
//     holds `0, 0` except a Sconce, whose acceleration is `SCONCE_DECEL`
//     (`600`) along the opposite of its launch direction".
//   - `specs/world.md` ("One tick"), phase 5: a due weapon fires "creating its
//     projectiles and zones at the lamplighter's and the enemies' positions of
//     this tick"; phase 6: a new projectile hits "at the position it was
//     created at and first moving on the next tick", so after the firing tick
//     the sconce sits at the lamplighter's center with its launch velocity.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick".
//
// WHAT IS READ. The one Sconce projectile after the firing tick: its center
// against the lamplighter's, its velocity against `(360, 480)`, its
// acceleration against `(-360, -480)`, and its pierce against `-1`. Both
// components of each vector are asserted, so a build that aims along an axis,
// launches from somewhere other than the center, decelerates along the wrong
// line, or accelerates outward instead fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Sconce alone at level 1, whose
// row has amount `1`, so one sconce is launched and no spread rotation stands
// between the aim and the reading. Every switch is off but `weaponFire`:
// `enemyMotion` off holds the moth at `(300, 400)` for the firing tick;
// `effectMotion` off holds the sconce at its launch for the reading, as phase
// 6 would anyway before its first move. The moth is `500` units out, so the
// sconce created at the center overlaps nothing and is still in `projectiles`
// to read.
//
// TOLERANCE. `MOTION_TOLERANCE` on the sconce's center against the
// lamplighter's, a position read back; `FIGURE_TOLERANCE` on each velocity and
// acceleration component, the product of a stated figure and a quotient of
// stated figures. None on pierce, a whole number the specification states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  INFINITE_PIERCE,
  MOTION_TOLERANCE,
  SCONCE_DECEL,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { AIM, launchOne, sconceRow } from "./boomerang";

/** The level-1 row's speed times the aim: `(360, 480)`. */
const VELOCITY = {
  vx: sconceRow(1).speed * AIM.x,
  vy: sconceRow(1).speed * AIM.y,
};

/** `−SCONCE_DECEL` times the aim: `(-360, -480)`. */
const ACCELERATION = {
  ax: -SCONCE_DECEL * AIM.x,
  ay: -SCONCE_DECEL * AIM.y,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("launches the sconce at the center with velocity 600 × (0.6, 0.8) and acceleration -600 × (0.6, 0.8)", async () => {
  const launch = await launchOne(h);
  captureStill(h, "launched");

  const { sconce } = launch;
  assertWithin(sconce.x, launch.from.x, MOTION_TOLERANCE, "the sconce's x");
  assertWithin(sconce.y, launch.from.y, MOTION_TOLERANCE, "the sconce's y");
  assertWithin(sconce.vx, VELOCITY.vx, FIGURE_TOLERANCE, "the sconce's vx");
  assertWithin(sconce.vy, VELOCITY.vy, FIGURE_TOLERANCE, "the sconce's vy");
  assertWithin(sconce.ax, ACCELERATION.ax, FIGURE_TOLERANCE, "the sconce's ax");
  assertWithin(sconce.ay, ACCELERATION.ay, FIGURE_TOLERANCE, "the sconce's ay");
  assertEqual(sconce.pierce, INFINITE_PIERCE, "the sconce's pierce");
});
