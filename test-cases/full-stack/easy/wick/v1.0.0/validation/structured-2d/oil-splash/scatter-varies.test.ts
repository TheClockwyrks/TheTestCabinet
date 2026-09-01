// oil-splash/scatter-varies — puddles land at random points.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "On
// firing, `amount` puddles appear, each centered at an independent uniformly
// random point of the disk of radius `OIL_SCATTER` (`400`) about the player's
// center: a distance `OIL_SCATTER × sqrt(u)` at a uniformly random angle, with
// `u` uniform on `[0, 1)`." `specs/instrumentation.md` ("A deterministic
// core"): "The game holds one pseudo-random generator, seeded by `reset` ...
// and every random draw comes from it: ... a puddle's landing point". So
// twenty draws from one generator fall at more than one point, and two
// generators laid with different seeds put their first puddle at different
// points; a build that lands every puddle at one fixed offset, or at the
// same point whatever the seed, has drawn nothing.
//
// WHAT IS COMPARED. Two readings, each one direction of the same
// requirement. Twenty firings from one seed, at level 1 so each is one
// puddle, are read as the set of distinct landing points, which must hold
// more than one. Then a fresh run from a second seed fires once, and its
// first puddle's point is compared against the first seed's first: the two
// must differ. Where each point lies, and that it is within the disk, is
// `scatter-within-radius`'s point.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, Oil Splash at level 1 armed, `weaponFire` on and every other switch
// off, the lamplighter at the origin for both seeds so the two draws are
// about the same center. The re-firings of the first run come through
// `setWeaponCooldown(slot, 0)`, so the generator is drawn from twenty times
// with no other system drawing between.
//
// THE TOLERANCE. None: two landing points are the same point or not. Two
// independent draws of a real-valued distance and angle coincide with
// probability zero, so a conformant build never fails by chance.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertGreaterThan,
  assertNotDeepEqual,
} from "../assert";
import { DEFAULT_SEED } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireAgain, fireOilSplash } from "./firing";

/** Level 1 of Oil Splash: one puddle a firing, so each firing is one draw. */
const LEVEL = 1;

/** How many firings the first seed makes. */
const FIRINGS = 20;

/** The two seeds: the default, and one other. */
const FIRST_SEED = DEFAULT_SEED;
const SECOND_SEED = DEFAULT_SEED + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands twenty puddles from one seed at more than one point, and two seeds' first puddles at different points", async () => {
  // The first seed, twenty draws.
  const points: [number, number][] = [];
  const first = await fireOilSplash(h, LEVEL, FIRST_SEED);
  for (const puddle of first.puddles) points.push([puddle.x, puddle.y]);
  for (let i = 1; i < FIRINGS; i += 1) {
    const firing = await fireAgain(h, first.slot);
    for (const puddle of firing.puddles) points.push([puddle.x, puddle.y]);
  }
  captureStill(h, "random");

  assertGreaterThan(
    points.length,
    1,
    `puddles created across ${FIRINGS} firings from seed ${FIRST_SEED} (specs/weapons.md, Oil Splash)`,
  );
  const distinct = new Set(points.map(([x, y]) => `${x},${y}`));
  assertGreaterThan(
    distinct.size,
    1,
    `distinct landing points among ${points.length} puddles from seed ${FIRST_SEED} (specs/weapons.md, Oil Splash)`,
  );

  // The second seed, one draw, against the first seed's first.
  const second = await fireOilSplash(h, LEVEL, SECOND_SEED);
  const firstPoint = points[0];
  const secondPuddle = second.puddles[0];
  assertDefined(
    secondPuddle,
    `the first puddle of the firing from seed ${SECOND_SEED} (specs/weapons.md, Oil Splash)`,
  );
  assertNotDeepEqual(
    [secondPuddle.x, secondPuddle.y],
    firstPoint,
    `the first puddle's landing point from seed ${SECOND_SEED}, against seed ${FIRST_SEED}'s (specs/instrumentation.md, Seeded randomness)`,
  );
});
