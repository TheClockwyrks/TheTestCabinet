// Wick — sconce/spread: two sconces leave at directions rotated -10 and +10
// degrees from the direction toward the nearest enemy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Sconce"): "Amount `n` launches `n` sconces on the
//     same tick, sconce `i` counted from `0` with its direction rotated by
//     `(i − (n − 1) / 2) × SCONCE_SPREAD` degrees, with `SCONCE_SPREAD`
//     (`20`)"; the level-2 row has amount `2`, so the two rotations are
//     `(0 − 0.5) × 20`, which is `-10`, and `(1 − 0.5) × 20`, which is `+10`.
//   - `specs/weapons.md` ("The nearest enemy"): "A direction toward an enemy
//     is the unit vector from the player's center to the enemy's center", and
//     "Angles are in degrees, with `0` along `+x` and positive angles turning
//     toward `+y`". A moth at `(300, 400)` from the center gives the direction
//     `(0.6, 0.8)`.
//   - `specs/weapons.md` ("Derived stats"): amount is "table value +
//     `amountBonus`", `0` with no Mirror held (`specs/passives.md`), and
//     "`SCONCE_SPREAD` ... unchanged by any passive".
//   - `specs/world.md` ("One tick"), phase 6: a new projectile is "first
//     moving on the next tick", so the launch velocities are what the firing
//     tick leaves.
//
// WHAT IS READ. After the firing tick: exactly two Sconce projectiles, and the
// unit velocity of each against the aim rotated by `-10` and by `+10` degrees,
// one sconce per rotation, as a set rather than by id. The two rotations are
// symmetric about the aim, so which sconce carries which is not something the
// specification fixes, and a build whose sconces both leave along the aim, or
// spread by some other angle, or turn the wrong way about `+y`, fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Sconce alone at level 2, every
// switch off but `weaponFire`. `enemyMotion` off holds the moth for the firing
// tick's read of the nearest enemy; `effectMotion` off holds each sconce at
// its launch velocity for the reading. The moth is `500` units out, so no
// sconce overlaps it on the firing tick.
//
// TOLERANCE. `DIRECTION_TOLERANCE` on each component of a unit velocity,
// against a rotation of an exact unit vector by an exact angle. None on the
// count, a whole number the row states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DIRECTION_TOLERANCE, SCONCE_SPREAD } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  rotate,
  unit,
  type Harness,
  type Point,
  type ProjectileSnapshot,
} from "../harness";
import { AIM, armSconce, sconceRow, targetsFor } from "./boomerang";

/** The level whose row has amount 2. */
const LEVEL = 2;

/** The rotations of a two-sconce launch: `(i − 0.5) × 20` for `i` of 0 and 1. */
const ROTATIONS = [0, 1].map((i) => (i - (2 - 1) / 2) * SCONCE_SPREAD);

/** The directions the two sconces must leave along, one each. */
const DIRECTIONS: readonly Point[] = ROTATIONS.map((deg) => rotate(AIM, deg));

/** Whether `sconce`'s unit velocity is `direction` within `DIRECTION_TOLERANCE`. */
function leavesAlong(sconce: ProjectileSnapshot, direction: Point): boolean {
  const heading = unit(sconce.vx, sconce.vy);
  return (
    Math.abs(heading.x - direction.x) <= DIRECTION_TOLERANCE &&
    Math.abs(heading.y - direction.y) <= DIRECTION_TOLERANCE
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("launches the two level-2 sconces at -10 and +10 degrees from the aim", async () => {
  assertEqual(sconceRow(LEVEL).amount, 2, "the level-2 row's amount");
  armSconce(h, LEVEL, targetsFor(1));

  const after = await h.tick(1);
  captureStill(h, "spread");

  const sconces = projectilesOf(after, "sconce");
  assertLength(sconces, 2, "Sconce projectiles after the firing tick");
  for (const [i, direction] of DIRECTIONS.entries()) {
    const along = sconces.filter((sconce) => leavesAlong(sconce, direction));
    assertLength(
      along,
      1,
      `sconces leaving at ${ROTATIONS[i]} degrees from the aim, ` +
        `unit velocities ${JSON.stringify(sconces.map((s) => unit(s.vx, s.vy)))}`,
    );
  }
});
