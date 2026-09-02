// weapons/nearest-tie-lowest-id — a distance tie goes to the lowest id.
//
// THE SPEC LINE. `specs/weapons.md`, "The nearest enemy": "The nearest enemy
// is the live enemy whose center is the smallest Euclidean distance from the
// player's center, ties broken by the lowest enemy `id`." `specs/enemies.md`,
// "The life of an enemy": "An enemy spawns with the next id from `nextId`, so
// ids ascend in spawn order", and `specs/instrumentation.md` has a posed enemy
// take the next id the same way, so the first moth posed holds the lower id.
// Ember at level 1 fires one bolt "in the direction of the nearest enemy's
// center", at `400` units per second.
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
// THE TOLERANCE. `REAL_EPS` on the distance between the bolt's unit direction
// and the unit vector toward the lower id; the two candidates, `(0, 1)` and
// `(1, 0)`, are over a unit apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNear } from "../assert";
import { REAL_EPS } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  distance,
  enemyById,
  holdWeapon,
  isolate,
  placeEnemyNear,
  projectilesCreatedSince,
  unit,
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

afterEach(() => {
  h.dispose();
});

it("aims an Ember bolt at the lower id of two equidistant moths", async () => {
  isolate(h);
  const lower = placeEnemyNear(h, "moth", LOWER.x, LOWER.y);
  const higher = placeEnemyNear(h, "moth", HIGHER.x, HIGHER.y);
  assertLessThan(lower, higher, "the first moth posed holds the lower id");
  const slot = holdWeapon(h, "ember", 1);
  armWeapon(h, slot);

  const posed = h.snapshot();
  const fired = await advanceTicks(h, 1);
  captureStill(h, "tie");

  const bolts = projectilesCreatedSince(posed, fired).filter(
    (projectile) => projectile.weapon === "ember",
  );
  assertEqual(
    bolts.length,
    1,
    "Ember bolts the firing tick created at level 1 (specs/weapons.md, Ember)",
  );
  const bolt = bolts[0];
  const target = enemyById(posed, lower);
  if (target === undefined) throw new Error("the posed lower moth is missing");
  const { player } = posed.run;
  const wanted = unit(target.x - player.x, target.y - player.y);
  assertNear(
    distance(unit(bolt.vx, bolt.vy), wanted),
    0,
    REAL_EPS,
    "how far the bolt's direction is from the unit vector toward the lower id (specs/weapons.md, The nearest enemy)",
  );
});
