// Wick — evolutions/beacon-aims-nearest: Beacon's bolt leaves toward the
// nearest enemy.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Beacon"): "a circle
// of `radius` fired from the player's center at `speed` toward the nearest
// enemy on the tick of firing". `specs/weapons.md` ("The nearest enemy"): "The
// nearest enemy is the live enemy whose center is the smallest Euclidean
// distance from the player's center", and "A direction toward an enemy is the
// unit vector from the player's center to the enemy's center". `BEACON_STATS`
// gives speed `500` and amount `1`. So with the lamplighter at the origin, a
// moth at `(300, 400)` — `500` units out, along `(0.6, 0.8)` — and a hound at
// `(0, -800)` — `800` out — the firing tick creates one bolt at `(0, 0)` with
// velocity `500 × (0.6, 0.8)` = `(300, 400)`.
//
// THE POSE. An isolated night with the lamplighter at the origin, the hound
// posed first so a build reading the lowest id rather than the distance is told
// apart, then the moth, then Beacon held at level 1 fired through the shared
// `fireWeapon`. `enemyMotion` is off, so both stand where they were posed on
// the firing tick, and `effectMotion` is off, so the bolt holds the velocity
// the firing gave it. Both stand far enough out that the bolt, created at the
// lamplighter's center, hits neither on its own tick.
//
// TOLERANCE. `POSITION_TOL` on the bolt's center against the lamplighter's,
// which the firing copies rather than integrates; `FLOAT_TOL` on the components
// of the velocity, a speed times a unit vector a build computes from the two
// centers exactly as the harness does.

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
import { boltsFired } from "./stage";

/** The nearest enemy: `500` from the origin along `(0.6, 0.8)`. */
const MOTH = { x: 300, y: 400 };

/** The farther enemy, posed first so a build aiming by id is told apart. */
const HOUND = { x: 0, y: -800 };

/** Beacon's fixed speed, `500`. */
const SPEED = weaponRow("beacon").speed as number;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires a Beacon bolt from the lamplighter's center at 500 × (0.6, 0.8) toward the nearer moth", async () => {
  await isolate(h);
  await placeEnemy(h, "hound", HOUND.x, HOUND.y);
  await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const firing = await fireWeapon(h, "beacon", 1);
  await captureStill(h, "aimed");

  const bolts = boltsFired(firing, "beacon");
  assertEqual(bolts.length, 1, "Beacon bolts the firing tick created");
  const bolt = bolts[0] as (typeof bolts)[number];
  const at = firing.before.run.player;
  assertNear(bolt.x, at.x, POSITION_TOL, "the bolt's x at creation");
  assertNear(bolt.y, at.y, POSITION_TOL, "the bolt's y at creation");
  const toward = directionToward(firing.before, MOTH);
  assertNear(bolt.vx, SPEED * toward.x, FLOAT_TOL, "the bolt's velocity, x");
  assertNear(bolt.vy, SPEED * toward.y, FLOAT_TOL, "the bolt's velocity, y");
});
