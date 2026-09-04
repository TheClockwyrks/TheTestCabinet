// director/spawn-angle-varies — the spawn angle is drawn, not fixed.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn ring": a spawn point sits at
// "an angle drawn uniformly from the seeded generator". `specs/enemies.md`,
// "The spawn director": "Its randomness, the spawn angle and the type choice,
// is drawn from the game's seeded generator", and
// `specs/instrumentation.md` ("A deterministic core") makes that generator
// "seeded by `reset`", so the draw follows the seed.
//
// WHAT A DRAW MEANS, IN TWO DIRECTIONS THAT ARE ONE REQUIREMENT. A build that
// spawns at one fixed angle satisfies neither; a build that varies the angle
// within a run but ignores the seed satisfies the first and not the second.
// Both readings are of the same stated draw, so both are read here: thirty
// spawns of one run do not all share an angle, and two runs seeded
// differently open at different angles.
//
// THE DRIVE. Window 0 with the timer at 0 and `spawning` alone on. Each
// arrival is removed on the tick it lands (`removeEnemy`: "Nothing drops,
// nothing counts as a kill, and no cue plays"), so `aliveCommons` stays at 0
// and the window's cap of 20 never holds the timer — the check is about the
// angles, not the cap. Nothing moves: `enemyMotion` is off, so every arrival
// is read at its spawn point.
//
// THE TOLERANCE. `ANGLE_EPS`, a millionth of a degree, as the bound two
// angles must differ by to count as different. A uniform draw lands two
// angles that close about never; a build that fixed its angle lands them
// exactly equal.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { ANGLE_EPS, SPAWN_WINDOWS, ticksOf } from "../constants";
import {
  angleOf,
  angularOffset,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, poseWindow } from "./spawns";

/** The two seeds the second reading compares; any two distinct values serve. */
const SEED_A = 1;
const SEED_B = 987_654;

/** Spawns read from one run, and the ticks that covers at window 0's interval. */
const SPAWNS = 30;
const BUDGET_TICKS = SPAWNS * ticksOf(SPAWN_WINDOWS[0]!.interval) + 1;

/** The angles of a run's spawns, in degrees about the lamplighter. */
async function spawnAngles(
  h: Harness,
  seed: number,
  count: number,
): Promise<number[]> {
  isolate(h, { seed });
  poseWindow(h, 0);
  enable(h, "spawning");
  const drive = await driveArrivals(h, BUDGET_TICKS, {
    removeOnArrival: true,
    stopAfter: count,
  });
  return drive.arrivals.map((arrival) =>
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

it("draws a different spawn angle across a run's spawns and across two seeds", async () => {
  const fromA = await spawnAngles(h, SEED_A, SPAWNS);
  const fromB = await spawnAngles(h, SEED_B, 1);
  captureStill(h, "angles");

  assertEqual(
    fromA.length,
    SPAWNS,
    `the spawns read from seed ${SEED_A} within ${BUDGET_TICKS} ticks`,
  );
  const spread = fromA.filter(
    (angle) => Math.abs(angularOffset(fromA[0], angle)) > ANGLE_EPS,
  ).length;
  assertGreaterThanOrEqual(
    spread,
    1,
    `the spawns of seed ${SEED_A} landing at an angle other than the first's ${fromA[0]}`,
  );

  assertEqual(fromB.length, 1, `the first spawn of seed ${SEED_B}`);
  assertGreaterThan(
    Math.abs(angularOffset(fromA[0], fromB[0])),
    ANGLE_EPS,
    `the degrees between the first spawn of seed ${SEED_A} and that of seed ${SEED_B}`,
  );
});
