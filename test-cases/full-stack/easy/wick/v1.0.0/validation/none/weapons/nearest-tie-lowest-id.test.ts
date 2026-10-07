// Wick — weapons/nearest-tie-lowest-id: a distance tie goes to the lowest id.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("The nearest enemy"):
// "The nearest enemy is the live enemy whose center is the smallest Euclidean
// distance from the player's center, ties broken by the lowest enemy `id`."
// `specs/enemies.md` ("The life of an enemy"): "An enemy spawns with the next id
// from `nextId`, so ids ascend in spawn order", and `specs/instrumentation.md`
// has a posed enemy take the next id the same way — so the first moth posed
// holds the lower id. Ember at level 1 fires one bolt "in the direction of the
// nearest enemy's center", at `400` units per second.
//
// THE POSE. Two moths exactly `200` from the lamplighter's center, one at
// `(0, 200)` and one at `(200, 0)`, both distances exact in floating point. The
// lower id is posed BELOW the player, at `(0, 200)`, and the higher to the
// right, so a build that breaks the tie by anything but id — the last enemy
// seen, the smaller `x`, the smaller angle from `+x` — aims at the wrong one.
// `effectMotion` and `enemyMotion` are held so the bolt's velocity and the two
// centers are read exactly as the firing tick set them; the bolt is created at
// the player's center and overlaps neither moth on that tick.
//
// TOLERANCE. `FLOAT_TOL` on the components of the bolt's unit direction; the
// two candidates, `(0, 1)` and `(1, 0)`, are a unit apart.

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

/** The moth posed first, so it holds the lower id. */
const LOWER = { x: 0, y: 200 };

/** The moth posed second, at the same distance. */
const HIGHER = { x: 200, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("aims an Ember bolt at the lower id of two equidistant moths", async () => {
  await isolate(h);
  const lower = await placeEnemy(h, "moth", LOWER.x, LOWER.y);
  const higher = await placeEnemy(h, "moth", HIGHER.x, HIGHER.y);
  assertTrue(lower.id < higher.id, "the first moth posed holds the lower id");

  const fired = await fireWeapon(h, "ember", 1);
  await captureStill(h, "tie");

  assertEqual(
    fired.projectiles.length,
    1,
    "Ember bolts the firing tick created at level 1",
  );
  const bolt = fired.projectiles[0]!;
  const heading = unitToward({ x: 0, y: 0 }, { x: bolt.vx, y: bolt.vy });
  assertTrue(heading !== null, "a bolt with a non-zero velocity");
  const wanted = directionToward(fired.before, lower);
  assertNear(heading!.x, wanted.x, FLOAT_TOL, "the bolt's direction, x");
  assertNear(heading!.y, wanted.y, FLOAT_TOL, "the bolt's direction, y");
});
