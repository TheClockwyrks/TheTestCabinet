// halo/pulse-hits-overlapping — a pulse hits every enemy overlapping the
// aura, and none outside it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): on a pulse
// "every enemy whose circle overlaps the aura takes `damage`". ("Shapes and
// overlap"): "Two circles overlap when the distance between their centers is
// less than the sum of their radii." Row 1 gives radius 80 and damage 3, and
// a moth's radius is 10 (`specs/enemies.md`), so the bound is 90: a moth
// whose center is 85 from the lamplighter's loses 3 of its 5 hp on the
// pulse, and one at 95 keeps every point.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with three moths posed by
// distance from the lamplighter's center: two at 85, in two directions, so
// "every" enemy inside is read and not just one, and one at 95 on a third
// side. Halo is held at level 1 with its timer at 0 and `weaponFire` the one
// switch on, so the first tick pulses. `enemyMotion` is off, so each moth
// is tested at exactly the distance it was posed at, and `enemyContact` is
// off, so nothing but the pulse touches any of them. No Glass is held, so
// `areaMul` is 1 and the radius reads the table's 80.
//
// THE TOLERANCE. `REAL_EPS` on the hp of the moths inside, one subtraction
// of a table figure; the moth outside is held to exactly the hp it was posed
// with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, HALO_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { armHalo, hpOf } from "./aura";

/** Row 1 of `HALO_LEVELS`: radius 80, damage 3. */
const ROW = HALO_LEVELS[0];

/** The overlap bound for the level-1 aura and a moth: `80 + 10`. */
const BOUND = ROW.radius + ENEMIES.moth.radius;

/** A center 5 inside the bound, and one 5 outside it. */
const INSIDE_DISTANCE = BOUND - 5;
const OUTSIDE_DISTANCE = BOUND + 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes 3 from each moth at distance 85 and nothing from the moth at 95", async () => {
  assertEqual(INSIDE_DISTANCE, 85, "the distance inside the bound");
  assertEqual(OUTSIDE_DISTANCE, 95, "the distance outside the bound");
  isolate(h);
  const inside = [
    placeEnemyNear(h, "moth", INSIDE_DISTANCE, 0),
    placeEnemyNear(h, "moth", 0, INSIDE_DISTANCE),
  ];
  const outside = placeEnemyNear(h, "moth", -OUTSIDE_DISTANCE, 0);
  armHalo(h, 1);
  const posed = h.snapshot();
  const insideBefore = inside.map((id) => hpOf(posed, id));
  const outsideBefore = hpOf(posed, outside);

  const pulsed = await advanceTicks(h, 1);
  captureStill(h, "overlap");

  inside.forEach((id, i) => {
    assertNear(
      hpOf(pulsed, id),
      insideBefore[i] - ROW.damage,
      REAL_EPS,
      `moth ${i} at distance ${INSIDE_DISTANCE}: hp after the pulse, ${ROW.damage} below ${insideBefore[i]} (specs/weapons.md, Halo)`,
    );
  });
  assertEqual(
    hpOf(pulsed, outside),
    outsideBefore,
    `the moth at distance ${OUTSIDE_DISTANCE}: hp after the pulse, untouched (specs/weapons.md, Shapes and overlap)`,
  );
});
