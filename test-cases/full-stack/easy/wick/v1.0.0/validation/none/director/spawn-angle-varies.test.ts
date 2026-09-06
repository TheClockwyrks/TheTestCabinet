// director/spawn-angle-varies — the angle a spawn arrives at is drawn, not
// fixed.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The spawn ring"): "A spawn
// point is `SPAWN_DISTANCE` (`760`) units from the lamplighter's center at an
// angle drawn uniformly over the full circle". Within one run the draw is
// uniform, so thirty spawns are not all at one angle: a build that placed every
// spawn at one angle has drawn nothing.
//
// WHAT THIS DOES NOT ASSERT. Nothing about the distribution's shape: the
// specification says uniform, and reading uniformity off thirty draws would
// fail a conformant build often enough to be worthless.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone and
// the field cleared between spawns, so the cap of twenty that row 0 of
// `SPAWN_WINDOWS` sets never holds a draw back, and the timer posed to `0` each
// time, so one spawn lands per tick and thirty draws take thirty ticks inside
// window 0. `enemyMotion` is off, so each enemy is read at the point it
// arrived at. Nothing is posed for the angle itself, so every draw is the
// build's own.
//
// THE TOLERANCE. `ANGLE_TOL`, the `1e-6` degrees an angle is allowed: two
// angles are the same reading when they are within it, and different when they
// are not. A uniform draw lands thirty angles all inside `1e-6` degrees of one
// another with probability nil.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { ANGLE_TOL } from "../constants";
import {
  angleFrom,
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  player,
  type Harness,
} from "../harness";

/** How many spawns the run draws. */
const DRAWS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The angle of the next spawn, with the field cleared and the timer posed due. */
async function drawAngle(): Promise<number> {
  await h.debug.clearEnemies();
  await h.debug.setSpawnTimer(0);
  const before = await h.snapshot();
  const after = await h.step(1);
  const arrivals = newEnemies(before, after);
  assertEqual(arrivals.length, 1, "enemies the director spawned on a due tick");
  return angleFrom(player(after), arrivals[0]!);
}

it("draws a spawn's angle rather than fixing it", async () => {
  await isolate(h, { on: ["spawning"] });
  const angles: number[] = [];
  for (let draw = 0; draw < DRAWS; draw += 1) angles.push(await drawAngle());
  const first = angles[0]!;
  await captureStill(h, "angles");

  assertTrue(
    angles.some((angle) => Math.abs(angle - first) > ANGLE_TOL),
    `two spawn angles differing by more than ${ANGLE_TOL} degrees across ${DRAWS} spawns (every spawn stood at ${first.toFixed(6)} degrees)`,
  );
});
