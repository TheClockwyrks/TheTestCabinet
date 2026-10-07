// ember/aims-nearest — the bolt leaves toward the nearest enemy's center.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"): "A bolt is a
// circle of `radius`, fired from the player's center at `speed` in the
// direction of the nearest enemy's center on the tick of firing." Level 1's
// row gives `speed` 400. And ("The nearest enemy"): "A direction toward an
// enemy is the unit vector from the player's center to the enemy's center".
// So with one moth at `(300, 400)` from a lamplighter at the origin, 500 units
// out, the unit vector is `(0.6, 0.8)` and the bolt's velocity is
// `400 × (0.6, 0.8) = (240, 320)`, leaving from `(0, 0)`.
//
// WHY THE BOLT IS READ AT THE PLAYER'S CENTER. `specs/world.md` ("One tick"),
// phase 6: a new projectile hits "at the position it was created at and first
// moving on the next tick", so after the firing tick the bolt still sits where
// it was fired from. The lamplighter holds no key, so its center is where the
// run began.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth at the first
// post of `TARGET_POSTS`, Ember at level 1 armed, `weaponFire` on and every
// other switch off: the moth neither moves nor touches the lamplighter, no
// other weapon fires, and Ember's amount of 1 makes one bolt on the tick.
// Whether two or three bolts pick the right two or three targets is
// `amount-fires-distinct-nearest`'s point; here the one enemy is the nearest.
//
// THE TOLERANCE. `REAL_EPS` on the start, which is a copy of the player's
// center, and `MOTION_EPS` on each velocity component, a stated speed times a
// unit vector each rounded by an ulp or two; a bolt aimed anywhere but at the
// moth's center is off by units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertPointNear } from "../assert";
import { EMBER_LEVELS, MOTION_EPS, REAL_EPS } from "../constants";
import { captureStill, createHarness, unit, type Harness } from "../harness";
import { fireEmber, TARGET_POSTS } from "./firing";

/** Level 1 of Ember: amount 1, speed 400. */
const LEVEL = 1;
const ROW = EMBER_LEVELS[LEVEL - 1];

/** The one moth: `(300, 400)`, whose unit vector from the origin is `(0.6, 0.8)`. */
const POST = TARGET_POSTS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the bolt from the lamplighter's center at 400 along (0.6, 0.8)", async () => {
  const firing = await fireEmber(h, LEVEL, [POST]);
  captureStill(h, "aimed");

  assertEqual(firing.bolts.length, 1, "the bolts the firing tick created");
  const bolt = firing.bolts[0];
  assertPointNear(
    bolt,
    firing.after.run.player,
    REAL_EPS,
    "the bolt's center on the firing tick, against the player's center",
  );
  const toward = unit(POST.x, POST.y);
  assertNear(
    bolt.vx,
    ROW.speed * toward.x,
    MOTION_EPS,
    "the bolt's vx, against 400 × 0.6",
  );
  assertNear(
    bolt.vy,
    ROW.speed * toward.y,
    MOTION_EPS,
    "the bolt's vy, against 400 × 0.8",
  );
});
