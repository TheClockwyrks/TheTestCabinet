// Wick — oil-splash/scatter-varies: puddles land at random points.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Oil Splash"): "On firing, `amount` puddles appear,
//     each centered at an independent uniformly random point of the disk of
//     radius `OIL_SCATTER` (`400`) about the player's center: a distance
//     `OIL_SCATTER × sqrt(u)` at a uniformly random angle, with `u` uniform
//     on `[0, 1)`."
//   - `specs/instrumentation.md` ("A deterministic core"): "The game holds one
//     pseudo-random generator, seeded by `reset` and keeping its whole state
//     in `rngState`, and every random draw comes from it: ... a puddle's
//     landing point"; (`reset`): "`options.seed` seeds the generator".
//   - `specs/instrumentation.md` (`setScreen`, `playing` from any other):
//     "`rngState` and `simTime` stay as they are, so a run from a known seed
//     is `reset` followed by this."
//
// WHAT IS READ. Two facts about the landing points. From one seed, the first
// puddle of each of twenty firings: they land on more than one distinct point,
// which a build that lands every puddle on one fixed point fails. Then, from a
// second seed, the first firing's first puddle: it lands somewhere other than
// where the first seed's first puddle did, which a build whose landing point
// ignores the generator, or whose generator ignores its seed, fails. Twenty
// draws of a uniform point of a disk coincide with probability zero, and two
// seeds of any pseudo-random generator that reads its seed draw different
// first points.
//
// WHY THE NIGHT IS POSED AS IT IS. Oil Splash alone at level 1 on an empty
// field, every switch off but `weaponFire`, and no key held, so every landing
// point is about the same center and the generator serves nothing but the
// puddles: no director, no offer, no spawn, and no drop draws from it.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) as the least by which two landing
// points are read as distinct, so two points the build placed on one point
// through slightly different arithmetic are still read as one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { DEFAULT_SEED, MOTION_TOLERANCE } from "../constants";
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

/** How many firings are sampled from the first seed. */
const FIRINGS = 20;

/** The two seeds: the default one, and another. */
const FIRST_SEED = DEFAULT_SEED;
const SECOND_SEED = DEFAULT_SEED + 1;

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

it("lands twenty puddles on more than one point, and a second seed's first puddle elsewhere", async () => {
  const first = armOilSplash(h, LEVEL, { seed: FIRST_SEED });
  const landings: Point[] = [];
  for (let firing = 1; firing <= FIRINGS; firing += 1) {
    const { created } = await fireOnce(h, first.slot);
    const puddle = present(created[0], `a puddle created on firing ${firing}`);
    landings.push({ x: puddle.x, y: puddle.y });
  }
  captureStill(h, "random");
  assertGreaterThan(
    distinctCount(landings),
    1,
    `distinct landing points across ${FIRINGS} firings from seed ${FIRST_SEED}`,
  );

  const second = armOilSplash(h, LEVEL, { seed: SECOND_SEED });
  const { created } = await fireOnce(h, second.slot);
  const puddle = present(
    created[0],
    `a puddle created on the first firing from seed ${SECOND_SEED}`,
  );
  assertTrue(
    differ(landings[0], puddle),
    `whether seed ${SECOND_SEED}'s first puddle (${puddle.x}, ${puddle.y}) landed away from seed ${FIRST_SEED}'s (${landings[0].x}, ${landings[0].y})`,
  );
});
