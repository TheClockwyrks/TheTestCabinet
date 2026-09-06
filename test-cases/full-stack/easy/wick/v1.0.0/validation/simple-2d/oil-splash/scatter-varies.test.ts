// Wick — oil-splash/scatter-varies: puddles land at random points.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Oil Splash"): "On firing, `amount` puddles appear,
//     each centered at an independent uniformly random point of the disk of
//     radius `OIL_SCATTER` (`400`) about the player's center: a distance
//     `OIL_SCATTER × sqrt(u)` at a uniformly random angle, with `u` uniform
//     on `[0, 1)`."
//
// WHAT IS READ. The first puddle of each of twenty firings: they land on more
// than one distinct point, which a build that lands every puddle on one fixed
// point fails. Twenty draws of a uniform point of a disk coincide with
// probability zero. Nothing is posed for the landing point, so every draw is
// the build's own; a posed point is `instrumentation/set-next-puddle-offset`.
//
// WHY THE NIGHT IS POSED AS IT IS. Oil Splash alone at level 1 on an empty
// field, every switch off but `weaponFire`, and no key held, so every landing
// point is about the same center.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) as the least by which two landing
// points are read as distinct, so two points the build placed on one point
// through slightly different arithmetic are still read as one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { MOTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  present,
  type Harness,
  type Point,
} from "../harness";
import { armOilSplash, fireOnce } from "./puddle";

/** The level held: any row serves, and row 1 is the acquisition row. */
const LEVEL = 1;

/** How many firings are sampled. */
const FIRINGS = 20;

/** Whether two points differ by more than `MOTION_TOLERANCE` on either axis. */
function differ(a: Point, b: Point): boolean {
  return (
    Math.abs(a.x - b.x) > MOTION_TOLERANCE ||
    Math.abs(a.y - b.y) > MOTION_TOLERANCE
  );
}

/** How many of `points` are distinct from every earlier one. */
function distinctCount(points: readonly Point[]): number {
  const kept: Point[] = [];
  for (const point of points) {
    if (kept.every((seen) => differ(seen, point))) kept.push(point);
  }
  return kept.length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands twenty puddles on more than one point", async () => {
  const armed = armOilSplash(h, LEVEL);
  const landings: Point[] = [];
  for (let firing = 1; firing <= FIRINGS; firing += 1) {
    const { created } = await fireOnce(h, armed.slot);
    const puddle = present(created[0], `a puddle created on firing ${firing}`);
    landings.push({ x: puddle.x, y: puddle.y });
  }
  captureStill(h, "random");
  assertGreaterThan(
    distinctCount(landings),
    1,
    `distinct landing points across ${FIRINGS} firings`,
  );
});
