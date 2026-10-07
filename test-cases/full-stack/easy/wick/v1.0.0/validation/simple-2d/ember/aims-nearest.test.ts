// Wick — ember/aims-nearest: the bolt leaves the lamplighter's center toward
// the nearest enemy's center.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Ember"): "A bolt is a circle of `radius`, fired
//     from the player's center at `speed` in the direction of the nearest
//     enemy's center on the tick of firing", and the level-1 row has speed
//     `400`.
//   - `specs/weapons.md` ("The nearest enemy"): "A direction toward an enemy
//     is the unit vector from the player's center to the enemy's center". A
//     moth at `(300, 400)` from the center is `500` away, so that unit vector
//     is `(0.6, 0.8)` and the bolt's velocity is `400 × (0.6, 0.8)`, which is
//     `(240, 320)`.
//   - `specs/world.md` ("One tick"), phase 5: a due weapon fires "creating its
//     projectiles and zones at the lamplighter's and the enemies' positions of
//     this tick"; phase 6: a new projectile hits "at the position it was
//     created at and first moving on the next tick", so after the firing tick
//     the bolt sits at the lamplighter's center with its launch velocity.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick".
//
// WHAT IS READ. Every Ember bolt after the firing tick: its center against the
// lamplighter's, and its velocity against `(240, 320)`. Both components are
// asserted, so a build that aims along an axis, at the enemy's edge, or from
// somewhere other than the center fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Ember alone at level 1, every
// switch off but `weaponFire`. `enemyMotion` off holds the moth at `(300, 400)`
// for the firing tick; `effectMotion` off holds the bolt at its launch for the
// reading, as phase 6 would anyway before its first move. The moth is `500`
// units out, so the bolt created at the center overlaps nothing and is still in
// `projectiles` to read.
//
// TOLERANCE. `MOTION_TOLERANCE` on the bolt's center against the lamplighter's,
// a position read back; `FIGURE_TOLERANCE` on each velocity component, the
// product of the stated speed and a quotient of stated figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, MOTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armEmber, emberRow } from "./volley";

/** The one moth, 500 units from the lamplighter's center. */
const MOTH = { x: 300, y: 400 };

/** The unit vector toward it, `(300, 400) / 500`. */
const DIRECTION = { x: 0.6, y: 0.8 };

/** The level-1 row's speed times that direction: `(240, 320)`. */
const EXPECTED = {
  vx: emberRow(1).speed * DIRECTION.x,
  vy: emberRow(1).speed * DIRECTION.y,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates the bolt at the lamplighter's center with velocity 400 × (0.6, 0.8)", async () => {
  const volley = armEmber(h, 1, [MOTH]);

  const after = await h.tick(1);
  captureStill(h, "aimed");

  const bolts = projectilesOf(after, "ember");
  assertGreaterThan(bolts.length, 0, "Ember bolts after the firing tick");
  for (const bolt of bolts) {
    assertWithin(
      bolt.x,
      volley.player.x,
      MOTION_TOLERANCE,
      `bolt ${bolt.id}: x of its center`,
    );
    assertWithin(
      bolt.y,
      volley.player.y,
      MOTION_TOLERANCE,
      `bolt ${bolt.id}: y of its center`,
    );
    assertWithin(bolt.vx, EXPECTED.vx, FIGURE_TOLERANCE, `bolt ${bolt.id}: vx`);
    assertWithin(bolt.vy, EXPECTED.vy, FIGURE_TOLERANCE, `bolt ${bolt.id}: vy`);
  }
});
