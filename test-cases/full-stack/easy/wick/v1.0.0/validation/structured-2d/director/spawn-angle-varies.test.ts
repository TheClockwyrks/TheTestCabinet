// director/spawn-angle-varies — the spawn angle is drawn, not fixed.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn ring": a spawn point sits at
// "an angle drawn uniformly over the full circle". `specs/enemies.md`, "The
// spawn director": "The spawn angle and the type choice are drawn at random
// as the rules below state".
//
// WHAT A DRAW MEANS. A build that spawns at one fixed angle draws nothing, so
// the reading is that thirty spawns of one run do not all share an angle.
// Nothing is posed for the angle, so every draw is the build's own; a posed
// angle is `instrumentation/set-next-spawn-angle`'s.
//
// THE DRIVE. Window 0 with `spawning` alone on, each spawn drawn on a tick of
// its own by `drawSpawns`: the timer is set to `0`, so the next tick spawns
// whatever the window's interval, and each arrival is removed on the tick it
// lands (`removeEnemy`: "Nothing drops, nothing counts as a kill, and no cue
// plays"), so `aliveCommons` stays at 0 and the window's cap of 20 never holds
// the timer — the check is about the angles, not the cap. Nothing moves:
// `enemyMotion` is off, so every arrival is read at its spawn point.
//
// THE TOLERANCE. `ANGLE_EPS`, a millionth of a degree, as the bound two
// angles must differ by to count as different. Thirty uniform draws all
// landing that close to the first happens about never; a build that fixed
// its angle lands them exactly equal.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { ANGLE_EPS } from "../constants";
import {
  angleOf,
  angularOffset,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { drawSpawns, poseWindow } from "./spawns";

/** Spawns read from one run. */
const SPAWNS = 30;

/** The angles of a run's spawns, in degrees about the lamplighter. */
async function spawnAngles(h: Harness, count: number): Promise<number[]> {
  isolate(h);
  poseWindow(h, 0);
  enable(h, "spawning");
  const spawns = await drawSpawns(h, count);
  return spawns.map((arrival) =>
    angleOf(
      arrival.enemy.x - arrival.player.x,
      arrival.enemy.y - arrival.player.y,
    ),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws a different spawn angle across a run's spawns", async () => {
  const angles = await spawnAngles(h, SPAWNS);
  captureStill(h, "angles");

  assertEqual(angles.length, SPAWNS, "the spawns read, one to a tick");
  const spread = angles.filter(
    (angle) => Math.abs(angularOffset(angles[0], angle)) > ANGLE_EPS,
  ).length;
  assertGreaterThanOrEqual(
    spread,
    1,
    `the spawns landing at an angle other than the first's ${angles[0]}, across ${SPAWNS}`,
  );
});
