// director/swarm-direction-varies — a swarm's direction is drawn, not fixed.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events"): the
// swarm's gnats stand "along a line perpendicular to a direction `d`, a unit
// vector at an angle drawn uniformly over the full circle". A build that lines
// its swarm up along a fixed direction gives the same angle every time and
// fails; a build that draws lays `SWARMS` (`6`) swarms along six angles that
// are not all one.
//
// WHAT THE READING SEPARATES. Nothing here asserts the distribution's shape: a
// handful of draws says nothing about uniformity, and reading uniformity off
// them would fail a conformant build often enough to be worthless.
//
// HOW `d` IS RECOVERED. `director/swarms.ts` states it: the mean of the
// twenty-four positions is the line's center, and `d` is the unit vector to it.
// No angle is assumed on any swarm, and none is posed.
//
// WHY THE WORLD IS POSED AS IT IS. Six isolated nights with `events` alone,
// each carried across the same tick by the same operations, so the draw is the
// only thing that differs between them.
//
// THE TOLERANCE. `ANGLE_TOL`, the `1e-6` degrees an angle is allowed: two
// directions are the same reading when they are within it. A uniform draw lands
// six angles all that close with probability nil.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { ANGLE_TOL } from "../constants";
import {
  angleFrom,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { poseSwarm } from "./swarms";

/** How many swarms are read. */
const SWARMS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays six swarms along directions that are not all one", async () => {
  const angles: number[] = [];
  for (let swarm = 0; swarm < SWARMS; swarm += 1) {
    const laid = await poseSwarm(h);
    angles.push(angleFrom(laid.at, laid.center));
  }
  await captureStill(h, "random");

  const first = angles[0]!;
  assertTrue(
    angles.some((angle) => Math.abs(angle - first) > ANGLE_TOL),
    `two swarm directions differing by more than ${ANGLE_TOL} degrees across ${SWARMS} swarms (every swarm lay along ${first.toFixed(6)} degrees)`,
  );
});
