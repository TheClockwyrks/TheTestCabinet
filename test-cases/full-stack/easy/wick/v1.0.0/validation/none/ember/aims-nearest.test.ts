// Wick — ember/aims-nearest: the bolt leaves the lamplighter's center toward
// the nearest enemy's center.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"): "A bolt is a
// circle of `radius`, fired from the player's center at `speed` in the
// direction of the nearest enemy's center on the tick of firing"; ("The
// nearest enemy"): "A direction toward an enemy is the unit vector from the
// player's center to the enemy's center". Row 1 of `EMBER_LEVELS` gives speed
// `400` and amount `1`. So with the lamplighter at the origin and one moth at
// `(300, 400)`, `500` units out, the firing tick creates one bolt at `(0, 0)`
// with velocity `400 × (0.6, 0.8)`.
//
// THE POSE. An isolated night with the lamplighter at the origin and one moth
// at `(300, 400)`, then Ember held at level 1 and fired through the shared
// `fireWeapon` (held, due, `weaponFire` on, one tick). `enemyMotion` is held so
// the moth stands where it was posed on the firing tick, and `effectMotion` is
// held so the bolt stands at the center it was created at with the velocity
// the firing gave it. The bolt is created `500` from the moth's center, so it
// hits nothing on its own tick and is present in the snapshot.
//
// TOLERANCE. `POSITION_TOL` on the bolt's center against the player's, which
// the firing copies rather than integrates; `FLOAT_TOL` on the components of
// the bolt's velocity, a speed times a unit vector a build computes from the
// two centers exactly as the harness does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  directionToward,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { EMBER, boltsOf } from "./stage";

/** The level whose row is fired: one bolt at `400` units per second. */
const LEVEL = 1;

/** The one moth: `500` from the origin along `(0.6, 0.8)`. */
const MOTH = { x: 300, y: 400 };

/** Ember's level-1 speed, `400`. */
const SPEED = weaponRow(EMBER, LEVEL).speed!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires an Ember bolt from the lamplighter's center at 400 × (0.6, 0.8) toward a moth at (300, 400)", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const firing = await fireWeapon(h, EMBER, LEVEL);
  await captureStill(h, "aimed");

  const bolts = boltsOf(firing);
  assertEqual(
    bolts.length,
    1,
    "Ember bolts the firing tick created at level 1",
  );
  const bolt = bolts[0]!;
  const at = firing.before.run.player;
  assertNear(bolt.x, at.x, POSITION_TOL, "the bolt's x at creation");
  assertNear(bolt.y, at.y, POSITION_TOL, "the bolt's y at creation");
  const toward = directionToward(firing.before, MOTH);
  assertNear(bolt.vx, SPEED * toward.x, FLOAT_TOL, "the bolt's velocity, x");
  assertNear(bolt.vy, SPEED * toward.y, FLOAT_TOL, "the bolt's velocity, y");
});
