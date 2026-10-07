// Wick — taper/slash-geometry: the slash extends `width` from the player's
// `x` in the facing direction and is centered on the player's `y`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "A slash is a rectangle of
//     `width × height`: on the tick it fires it hits every enemy overlapping
//     it ... Its near vertical edge is at the player's `x`, it extends
//     `width` in the facing direction, and it is centered vertically on the
//     player's `y`." Row 1 of `TAPER_LEVELS`: width 120, height 40, so facing
//     right the rectangle is `x` from `player.x` to `player.x + 120` and `y`
//     from `player.y − 20` to `player.y + 20`.
//   - `specs/weapons.md` ("Shapes and overlap"): "A rectangle and a circle
//     overlap when the distance from the circle's center to the nearest point
//     of the rectangle is less than the circle's radius." A moth's radius is
//     10 (`specs/enemies.md`).
//   - `specs/world.md` ("The lamplighter"): "A run starts with the lamplighter
//     at the origin, facing `"right"`".
//
// THE DRIVE. An isolated run at the origin facing right, Taper at level 1
// armed, `weaponFire` the one switch on, and three moths posed against the
// rectangle: one at (+100, 0), inside it; one at (−30, 0), behind the near
// edge, 30 units from the rectangle's nearest point (0, 0); and one at
// (+60, +40), below it, 20 units from the nearest point (60, 20). The firing
// tick runs once. The inside moth is hit, and the other two are untouched,
// because 30 and 20 are both beyond a moth's radius of 10.
//
// WHY THESE THREE. Each probe is at least 10 units clear of the boundary it
// tests, so a build off by a unit or two in either direction still reads the
// same way here; where the boundary falls exactly is
// `rect-overlap-nearest-point`'s point. The three together tell the stated
// rectangle from one centered on the player (which would reach −30), one
// twice the height (which would reach +40), and one that reads facing
// backwards (which would miss +100).
//
// TOLERANCE. None on the outcomes; `REAL_EPS` on the untouched moths' `hp`,
// which is read against the value it was posed with.

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

/** The probes, as offsets from the lamplighter's center. */
const INSIDE = { dx: 100, dy: 0 };
const BEHIND = { dx: -30, dy: 0 };
const BELOW = { dx: 60, dy: 40 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits a moth 100 right of the player and misses one 30 left and one 40 below", async () => {
  const moth = ENEMIES.moth;
  if (!(INSIDE.dx < ROW.width && BEHIND.dx <= -moth.radius)) {
    throw new Error("the probes must sit inside and clear of the rectangle");
  }
  if (!(BELOW.dy - ROW.height / 2 >= moth.radius)) {
    throw new Error("the below probe must sit clear of the bottom edge");
  }

  const posed = isolate(h);
  assertEqual(posed.run.player.facing, "right", "the fresh run's facing");
  const inside = placeEnemyNear(h, "moth", INSIDE.dx, INSIDE.dy);
  const behind = placeEnemyNear(h, "moth", BEHIND.dx, BEHIND.dy);
  const below = placeEnemyNear(h, "moth", BELOW.dx, BELOW.dy);
  const before = h.snapshot();
  const hpBehind = hpOf(before, behind);
  const hpBelow = hpOf(before, below);
  armTaper(h, LEVEL);

  const after = await advanceTicks(h, 1);
  captureStill(h, "geometry");

  assertEqual(
    zonesOfKind(after, "slash").length,
    ROW.amount,
    "the slashes the firing tick created",
  );
  assertEqual(
    enemyOutcome(after, inside, hpOf(before, inside)),
    "hit",
    "the moth at (player.x + 100, player.y), inside the rectangle",
  );
  assertEqual(
    enemyOutcome(after, behind, hpBehind),
    "untouched",
    "the moth at (player.x − 30, player.y), behind the near edge",
  );
  assertNear(
    hpOf(after, behind),
    hpBehind,
    REAL_EPS,
    "the behind moth's hp after the firing tick",
  );
  assertEqual(
    enemyOutcome(after, below, hpBelow),
    "untouched",
    "the moth at (player.x + 60, player.y + 40), below the rectangle",
  );
  assertNear(
    hpOf(after, below),
    hpBelow,
    REAL_EPS,
    "the below moth's hp after the firing tick",
  );
});
