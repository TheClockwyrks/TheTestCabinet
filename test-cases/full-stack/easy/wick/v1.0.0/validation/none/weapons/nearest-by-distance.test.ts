// Wick — weapons/nearest-by-distance: the nearest enemy is the one whose center
// is the smallest distance from the player's center.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("The nearest enemy"):
// "The nearest enemy is the live enemy whose center is the smallest Euclidean
// distance from the player's center, ties broken by the lowest enemy `id`. ...
// A direction toward an enemy is the unit vector from the player's center to
// the enemy's center". And under "Ember": "A bolt is a circle of `radius`,
// fired from the player's center at `speed` in the direction of the nearest
// enemy's center on the tick of firing", with level 1 firing one bolt at
// `400` units per second.
//
// THE POSE. The lamplighter at the origin, a moth at `(200, 0)` and a hound at
// `(0, −150)`: the hound's center is the nearer at `150` against `200`. The
// radii are `10` and `18` (`specs/enemies.md`), so the ordering is by centers
// whatever a build makes of the radii — and a build that chose the moth has
// aimed by something other than the stated rule. The bolt's velocity is the
// reading: `effectMotion` is held, so the bolt stands at the center it was
// created at with the velocity the firing gave it; `enemyMotion` is held so the
// two enemies stand where they were posed on the firing tick; nothing else
// runs. The bolt is created at the player's center, which overlaps neither
// enemy, so it hits nothing on its tick and is present in the snapshot.
//
// TOLERANCE. `FLOAT_TOL` on the components of the bolt's unit direction, which
// a build computes from the two centers exactly as the harness does; the two
// candidate directions, `(0, −1)` and `(1, 0)`, are a unit apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertTrue } from "../assert";
import { FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  directionToward,
  fireWeapon,
  isolate,
  placeEnemy,
  unitToward,
  type Harness,
} from "../harness";

/** The farther enemy: a moth, `200` from the player's center. */
const MOTH = { x: 200, y: 0 };

/** The nearer enemy: a hound, `150` from the player's center. */
const HOUND = { x: 0, y: -150 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("aims an Ember bolt at the enemy whose center is nearer", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", MOTH.x, MOTH.y);
  const hound = await placeEnemy(h, "hound", HOUND.x, HOUND.y);

  const fired = await fireWeapon(h, "ember", 1);
  await captureStill(h, "nearest");

  assertEqual(
    fired.projectiles.length,
    1,
    "Ember bolts the firing tick created at level 1",
  );
  const bolt = fired.projectiles[0]!;
  const heading = unitToward({ x: 0, y: 0 }, { x: bolt.vx, y: bolt.vy });
  assertTrue(heading !== null, "a bolt with a non-zero velocity");
  const wanted = directionToward(fired.before, hound);
  assertNear(heading!.x, wanted.x, FLOAT_TOL, "the bolt's direction, x");
  assertNear(heading!.y, wanted.y, FLOAT_TOL, "the bolt's direction, y");
});
