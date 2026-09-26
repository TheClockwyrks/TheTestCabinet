// oil-splash/scatter-varies — puddles land at random points.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"): "On
// firing, `amount` puddles appear, each centered at an independent uniformly
// random point of the disk of radius `OIL_SCATTER` (`400`) about the player's
// center: a distance `OIL_SCATTER × sqrt(u)` at a uniformly random angle, with
// `u` uniform on `[0, 1)`." So twenty draws fall at more than one point; a
// build that lands every puddle at one fixed offset has drawn nothing.
//
// WHAT IS COMPARED. Twenty firings at level 1, so each is one puddle, are
// read as the set of distinct landing points, which must hold more than one.
// Nothing is posed for the landing point, so every draw is the build's own; a
// posed point is `instrumentation/set-next-puddle-offset`'s. Where each point
// lies, and that it is within the disk, is `scatter-within-radius`'s point.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, Oil Splash at level 1 armed, `weaponFire` on and every other switch
// off, the lamplighter at the origin so every draw is about the same center.
// The re-firings come through `setWeaponCooldown(slot, 0)`, so each firing is
// the next tick's.
//
// THE TOLERANCE. None: two landing points are the same point or not. Twenty
// independent draws of a real-valued distance and angle coincide with
// probability zero, so a conformant build never fails by chance.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireAgain, fireOilSplash } from "./firing";

/** Level 1 of Oil Splash: one puddle a firing, so each firing is one draw. */
const LEVEL = 1;

/** How many firings are read. */
const FIRINGS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands twenty puddles at more than one point", async () => {
  const points: [number, number][] = [];
  const first = await fireOilSplash(h, LEVEL);
  for (const puddle of first.puddles) points.push([puddle.x, puddle.y]);
  for (let i = 1; i < FIRINGS; i += 1) {
    const firing = await fireAgain(h, first.slot);
    for (const puddle of firing.puddles) points.push([puddle.x, puddle.y]);
  }
  captureStill(h, "random");

  assertGreaterThan(
    points.length,
    1,
    `puddles created across ${FIRINGS} firings (specs/weapons.md, Oil Splash)`,
  );
  const distinct = new Set(points.map(([x, y]) => `${x},${y}`));
  assertGreaterThan(
    distinct.size,
    1,
    `distinct landing points among ${points.length} puddles (specs/weapons.md, Oil Splash)`,
  );
});
