// evolutions/beacon-aims-nearest — Beacon's bolt leaves toward the nearest
// enemy.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Beacon"): "a circle
// of `radius` fired from the player's center at `speed` toward the nearest
// enemy on the tick of firing", with `BEACON_STATS` giving speed 500.
// `specs/weapons.md` ("The nearest enemy"): "The nearest enemy is the live
// enemy whose center is the smallest Euclidean distance from the player's
// center", and "A direction toward an enemy is the unit vector from the
// player's center to the enemy's center." With a moth at `(300, 400)`, 500
// units from the origin, and a hound at `(0, -800)`, 800 units out, the moth
// is the nearest and the unit vector toward it is exactly `(0.6, 0.8)`, so the
// bolt's velocity is `500 × (0.6, 0.8)` = `(300, 400)`, leaving from the
// player's center.
//
// WHY THE BOLT IS READ AT THE PLAYER'S CENTER. `specs/world.md` ("One tick"),
// phase 6: a new projectile hits "at the position it was created at and first
// moving on the next tick", so after the firing tick the bolt still sits where
// it was fired from, carrying the velocity the firing gave it.
//
// WHY THE FARTHER ENEMY IS A HOUND. Its 120 base `hp` (`specs/enemies.md`)
// outlasts anything on this tick, so a build that aimed at it would be read on
// the velocity rather than on a death; and it stands on a different axis from
// the moth, so the two directions cannot be confused. `enemyMotion` is off, so
// both stand where they were posed on the firing tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with those two enemies and
// nothing else, no passive, Beacon armed, `weaponFire` the one switch on, so
// Beacon's amount of 1 makes one bolt and the one enemy nearer than the other
// is the whole of the choice. That `n` bolts pick the `n` nearest is
// `beacon-amount-bonus`'s point.
//
// THE TOLERANCE. `REAL_EPS` on the start, a copy of the player's center, and
// `MOTION_EPS` on each velocity component, a stated speed times a unit vector.
// A bolt aimed at the hound instead reads `(0, -500)`, hundreds of units away
// on both components.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertPointNear } from "../assert";
import { BEACON_STATS, MOTION_EPS, REAL_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  unit,
  type Harness,
} from "../harness";
import { fireFromPosed } from "./evolved";

/** The nearest enemy: 500 units out, on the 3-4-5 direction `(0.6, 0.8)`. */
const NEAR = { x: 300, y: 400 };

/** The farther enemy: 800 units out, on another axis. */
const FAR = { x: 0, y: -800 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the bolt from the lamplighter's center at 500 along (0.6, 0.8)", async () => {
  if (!(Math.hypot(NEAR.x, NEAR.y) < Math.hypot(FAR.x, FAR.y))) {
    throw new Error("the moth must be the nearer of the two");
  }

  isolate(h);
  placeEnemyNear(h, "moth", NEAR.x, NEAR.y);
  placeEnemyNear(h, "hound", FAR.x, FAR.y);

  const firing = await fireFromPosed(h, "beacon");
  captureStill(h, "aimed");

  assertEqual(
    firing.projectiles.length,
    BEACON_STATS.amount,
    "the bolts the firing tick created (specs/evolutions.md, Beacon)",
  );
  const bolt = firing.projectiles[0];
  assertPointNear(
    bolt,
    firing.after.run.player,
    REAL_EPS,
    "the bolt's center on the firing tick, against the player's center (specs/evolutions.md, Beacon)",
  );
  const toward = unit(NEAR.x, NEAR.y);
  assertNear(
    bolt.vx,
    BEACON_STATS.speed * toward.x,
    MOTION_EPS,
    "the bolt's vx, against 500 × 0.6 (specs/evolutions.md, Beacon)",
  );
  assertNear(
    bolt.vy,
    BEACON_STATS.speed * toward.y,
    MOTION_EPS,
    "the bolt's vy, against 500 × 0.8 (specs/evolutions.md, Beacon)",
  );
});
