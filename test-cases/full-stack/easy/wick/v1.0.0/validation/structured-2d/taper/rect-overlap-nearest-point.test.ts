// Wick — taper/rect-overlap-nearest-point: a rectangle and a circle overlap
// when the circle's center is strictly closer than its radius to the
// rectangle's nearest point.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shapes and overlap"): "A rectangle and a circle
//     overlap when the distance from the circle's center to the nearest point
//     of the rectangle is less than the circle's radius."
//   - `specs/weapons.md` ("Taper"): the slash "extends `width` in the facing
//     direction" from the player's `x`; row 1 of `TAPER_LEVELS` gives width
//     120, so facing right its far edge is the line `x = player.x + 120`.
//   - `specs/enemies.md` ("Common enemies"): a moth's radius is 10.
//
// THE DRIVE. An isolated run at the origin facing right, Taper at level 1
// armed, `weaponFire` the one switch on, and two moths on the player's `y`
// beyond the far edge: one with its center 5 units past it, at
// (player.x + 125, player.y), whose nearest rectangle point is 5 away, less
// than 10; and one 10 units past it, at (player.x + 130, player.y), whose
// nearest point is exactly 10 away, not less than 10. The firing tick runs
// once. The near moth is hit and the far one untouched.
//
// WHY 5 AND 10. Both centers lie OUTSIDE the rectangle, so a build that
// tests the center against the rectangle alone misses the first; and the
// second sits exactly on the stated bound, so a build that wrote "at most"
// for "less than" hits it. The two together decide both halves of the rule.
//
// TOLERANCE. None: 125 − 120 and 130 − 120 are exact in binary floating
// point, as is a moth's radius of 10, so the boundary reading is exact.
// `REAL_EPS` on the untouched moth's `hp`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, REAL_EPS, TAPER_LEVELS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armTaper, enemyOutcome, hpOf } from "./slash";

/** The row under test: level 1, a 120 × 40 slash. */
const LEVEL = 1;
const ROW = TAPER_LEVELS[LEVEL - 1];

/** How far past the far edge each moth's center sits. */
const INSIDE_BY = 5;
const ON_BOUND_BY = ENEMIES.moth.radius;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits a moth 5 past the far edge and misses one exactly a radius past it", async () => {
  if (!(INSIDE_BY < ENEMIES.moth.radius)) {
    throw new Error("the near probe must be inside the moth's radius");
  }

  const posed = isolate(h);
  assertEqual(posed.run.player.facing, "right", "the fresh run's facing");
  const near = placeEnemyNear(h, "moth", ROW.width + INSIDE_BY, 0);
  const onBound = placeEnemyNear(h, "moth", ROW.width + ON_BOUND_BY, 0);
  const before = h.snapshot();
  const hpNear = hpOf(before, near);
  const hpOnBound = hpOf(before, onBound);
  armTaper(h, LEVEL);

  const after = await advanceTicks(h, 1);
  captureStill(h, "nearest");

  assertEqual(
    zonesOfKind(after, "slash").length,
    ROW.amount,
    "the slashes the firing tick created",
  );
  assertEqual(
    enemyOutcome(after, near, hpNear),
    "hit",
    `the moth ${INSIDE_BY} units past the far edge`,
  );
  assertEqual(
    enemyOutcome(after, onBound, hpOnBound),
    "untouched",
    `the moth ${ON_BOUND_BY} units past the far edge, exactly a radius away`,
  );
  assertNear(
    hpOf(after, onBound),
    hpOnBound,
    REAL_EPS,
    "the on-bound moth's hp after the firing tick",
  );
});
