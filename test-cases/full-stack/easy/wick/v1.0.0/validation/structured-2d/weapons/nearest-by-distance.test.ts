// weapons/nearest-by-distance — the nearest enemy is the one whose center is
// the smallest distance from the player's center.
//
// THE SPEC LINE. `specs/weapons.md`, "The nearest enemy": "The nearest enemy
// is the live enemy whose center is the smallest Euclidean distance from the
// player's center, ties broken by the lowest enemy `id`. ... A direction toward
// an enemy is the unit vector from the player's center to the enemy's center".
// And under "Ember": "A bolt is a circle of `radius`, fired from the player's
// center at `speed` in the direction of the nearest enemy's center on the tick
// of firing", with level 1 firing one bolt at `400` units per second.
//
// TWO POSES, ONE RULE. The first poses the lamplighter at the origin, a moth
// at `(200, 0)` and a hound at `(0, −150)`: the hound's center is the nearer
// at `150` against `200`, so a build that aimed by anything but proximity —
// the last enemy seen, the smaller `x`, the smaller angle from `+x` — chose
// the moth. The second poses the two so that CENTERS and EDGES disagree: a
// moth at `(150, 0)`, radius `10` (`specs/enemies.md`), and a hound at
// `(0, −155)`, radius `18`. The moth's center is nearer at `150` against
// `155`, while the hound's near edge is nearer at `137` against `140`, so a
// build measuring to the enemy's surface rather than its center aims at the
// hound and fails. Both poses read the same rule, in the same direction: the
// smallest CENTER distance.
//
// WHAT IS READ. The bolt's velocity: `effectMotion` is held, so a bolt stands
// at the center it was created at with the velocity the firing gave it;
// `enemyMotion` is held so the enemies stand where they were posed on the
// firing tick; nothing else runs. A bolt is created at the player's center,
// which overlaps neither enemy in either pose, so it hits nothing on its tick
// and is in the snapshot.
//
// THE TOLERANCE. `REAL_EPS` on the distance between the bolt's unit direction
// and the unit vector toward the enemy the rule names, which a build computes
// from the two centers by one normalization. In each pose the two candidate
// directions are `(0, −1)` and `(1, 0)`, over a unit apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
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
  type WickSnapshot,
} from "../harness";

/** The farther enemy of the first pose: a moth, `200` from the player's center. */
const MOTH = { x: 200, y: 0 };

/** The nearer enemy of the first pose: a hound, `150` from the player's center. */
const HOUND = { x: 0, y: -150 };

/** The nearer CENTER of the second pose: a moth at `150`, its near edge at `140`. */
const NEAR_CENTER = { x: 150, y: 0 };

/** The nearer EDGE of the second pose: a hound at `155`, its near edge at `137`. */
const NEAR_EDGE = { x: 0, y: -155 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/**
 * Fire one Ember bolt from the world as it stands and answer how far its
 * direction is from the unit vector toward `wanted`.
 */
async function aimGap(
  slot: number,
  targetId: number,
  what: string,
): Promise<number> {
  armWeapon(h, slot);
  const posed: WickSnapshot = h.snapshot();
  const fired = await advanceTicks(h, 1);
  const bolts = projectilesCreatedSince(posed, fired).filter(
    (projectile) => projectile.weapon === "ember",
  );
  assertEqual(
    bolts.length,
    1,
    `Ember bolts the ${what} firing tick created at level 1 (specs/weapons.md, Ember)`,
  );
  const target = enemyById(posed, targetId);
  if (target === undefined) throw new Error(`the posed ${what} target is gone`);
  const { player } = posed.run;
  return distance(
    unit(bolts[0].vx, bolts[0].vy),
    unit(target.x - player.x, target.y - player.y),
  );
}

it("aims an Ember bolt at the enemy whose center is nearer", async () => {
  isolate(h);
  const slot = holdWeapon(h, "ember", 1);

  placeEnemyNear(h, "moth", MOTH.x, MOTH.y);
  const hound = placeEnemyNear(h, "hound", HOUND.x, HOUND.y);
  const plain = await aimGap(slot, hound, "nearer-center");
  captureStill(h, "nearest");
  assertNear(
    plain,
    0,
    REAL_EPS,
    "how far the bolt's direction is from the unit vector toward the nearer enemy (specs/weapons.md, The nearest enemy)",
  );

  // The same rule where centers and edges disagree.
  h.debug.clearEnemies();
  h.debug.clearProjectiles();
  const nearCenter = placeEnemyNear(h, "moth", NEAR_CENTER.x, NEAR_CENTER.y);
  placeEnemyNear(h, "hound", NEAR_EDGE.x, NEAR_EDGE.y);
  const contested = await aimGap(
    slot,
    nearCenter,
    "nearer-center-farther-edge",
  );
  assertNear(
    contested,
    0,
    REAL_EPS,
    "how far the bolt's direction is from the unit vector toward the nearer CENTER, the hound's edge being nearer (specs/weapons.md, The nearest enemy)",
  );
});
