// director/swarm-direction-varies — a swarm's direction is drawn, not fixed.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events"): the
// swarm's gnats stand "along a line perpendicular to a direction `d`, a unit
// vector at an angle drawn uniformly from the seeded generator". The generator
// is the game's one, "seeded by `reset`", and "Given the same seed, the same
// sequence of operations, and the same number of ticks, the game reaches the
// same `run` and `rngState` every time" (specs/instrumentation.md) — a
// statement about the SAME seed, so two runs seeded differently and driven the
// same way lay their swarm along different directions.
//
// WHAT THE READING SEPARATES. A build that lines its swarm up along a fixed
// direction, or along one that ignores the seed, gives the same angle twice and
// fails. Nothing here asserts the distribution's shape: two draws say nothing
// about uniformity, and reading uniformity off a handful of draws would fail a
// conformant build often enough to be worthless.
//
// HOW `d` IS RECOVERED. `director/swarms.ts` states it: the mean of the
// twenty-four positions is the line's center, and `d` is the unit vector to it.
// No angle is assumed on either run.
//
// WHY THE WORLD IS POSED AS IT IS. Two isolated nights with `events` alone, one
// seeded with the default and one with another whole number in `reset`'s
// domain, each carried across the same tick by the same operations, so the seed
// is the only thing that differs between them.
//
// THE TOLERANCE. `ANGLE_TOL`, the `1e-6` degrees an angle is allowed: two
// directions are the same reading when they are within it. A uniform draw lands
// two angles that close with probability about `3e-9`.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { ANGLE_TOL, DEFAULT_SEED } from "../constants";
import {
  angleFrom,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { poseSwarm } from "./swarms";

/** The second seed: any whole number in `[0, 2^32 − 1]` that is not the first. */
const OTHER_SEED = 20260901;

/** The angle of `d`, in degrees, read from the swarm's own gnats. */
function directionAngle(
  at: { x: number; y: number },
  center: { x: number; y: number },
): number {
  return angleFrom(at, center);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays swarms from two seeds along different directions", async () => {
  const first = await poseSwarm(h, DEFAULT_SEED);
  const firstAngle = directionAngle(first.at, first.center);

  const other = await poseSwarm(h, OTHER_SEED);
  const otherAngle = directionAngle(other.at, other.center);
  await captureStill(h, "random");

  assertTrue(
    Math.abs(otherAngle - firstAngle) > ANGLE_TOL,
    `the swarm direction from seed ${OTHER_SEED} (${otherAngle.toFixed(6)} degrees) differing from seed ${DEFAULT_SEED}'s (${firstAngle.toFixed(6)} degrees)`,
  );
});
