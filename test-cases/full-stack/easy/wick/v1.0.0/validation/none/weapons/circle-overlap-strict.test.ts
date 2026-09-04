// Wick — weapons/circle-overlap-strict: two circles overlap only when closer
// than their radii's sum.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shapes and overlap"):
// "Two circles overlap when the distance between their centers is less than
// the sum of their radii." An Ember bolt's level-1 radius is `8` and a moth's
// radius is `10` (`specs/enemies.md`), so their sum is `18`: a bolt whose
// center is exactly `18` from the moth's never hits, and one at `17.9` hits on
// the tick after it is posed. `18` is exact in binary floating point and so is
// `sqrt(324)`, so a build that compares `<=` hits at `18` and a build that
// compares `<` does not.
//
// THE POSE. A moth at `(300, 0)`. First a bolt with zero velocity and pierce
// `0` at `(318, 0)`, left for `30` ticks: the moth keeps its `5` hp and the
// bolt stays. Then that bolt cleared and one posed at `(317.9, 0)`: the next
// tick's hit takes the moth's `5` hp below zero and spends the pierce-`0`
// bolt. Every faculty is held: `effectMotion` so each bolt stays exactly where
// it was posed, `enemyMotion` so the moth does, and the rest so nothing else
// lands. The moth stands clear of the lamplighter.
//
// TOLERANCE. None: the reading is a posed hp and presence, and the boundary is
// the specification's own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { ENEMIES, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  mustEnemy,
  mustProjectile,
  placeEnemy,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

/** Where the moth stands, clear of the lamplighter. */
const MOTH = { x: 300, y: 0 };

/** The sum of the two radii: `8 + 10`. */
const TOUCHING = weaponRow("ember", 1).radius! + ENEMIES.moth.radius;

/** How far inside the boundary the second bolt is posed. */
const INSIDE = 0.1;

/** The ticks the boundary bolt is left beside the moth. */
const HELD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never hits at exactly the radii's sum, and hits just inside it", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  // Exactly 18 apart: never a hit.
  const boundary = await placeProjectile(
    h,
    "ember",
    MOTH.x + TOUCHING,
    MOTH.y,
    0,
    0,
    0,
  );
  const held = await h.step(HELD_TICKS);
  assertEqual(
    mustEnemy(held, moth.id).hp,
    ENEMIES.moth.hp,
    `the moth's hp after ${HELD_TICKS} ticks beside a bolt exactly ${TOUCHING} away`,
  );
  // Still there: a pierce-0 bolt that had hit would have been spent.
  mustProjectile(held, boundary.id);

  // 17.9 apart: a hit on the next tick.
  await h.debug.clearProjectiles();
  const inside = await placeProjectile(
    h,
    "ember",
    MOTH.x + TOUCHING - INSIDE,
    MOTH.y,
    0,
    0,
    0,
  );
  const hit = await h.step(1);
  await captureStill(h, "boundary");
  assertUndefined(
    enemyById(hit, moth.id),
    `the moth on the tick after a bolt ${TOUCHING - INSIDE} away was posed`,
  );
  assertUndefined(
    projectileById(hit, inside.id),
    "the pierce-0 bolt after its hit",
  );
});
