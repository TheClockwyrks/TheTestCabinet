// director/spawn-ring-distance — a window spawn lands on the spawn ring.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn ring": "A spawn point is
// `SPAWN_DISTANCE` (`760`) units from the lamplighter's center at an angle
// drawn uniformly from the seeded generator: `x = player.x + cos(angle) *
// SPAWN_DISTANCE`, `y = player.y + sin(angle) * SPAWN_DISTANCE`." The angle is
// random and the distance is not, so the distance is what a check can hold a
// build to.
//
// WHEN THE DISTANCE IS LEGIBLE. On the spawn tick alone. `specs/world.md`
// ("One tick", phase 10) puts the director last and says "An enemy spawned on
// this tick sits at its spawn point and first moves on the next tick", so the
// drive steps one tick at a time and reads each arrival in the snapshot of the
// tick it appeared on, before any step of its own could shorten the distance.
// `enemyMotion` stays off besides, so nothing moves at all.
//
// WHY THE LAMPLIGHTER STANDS AWAY FROM THE ORIGIN. The formula is written
// around `player.x` and `player.y`, not around the origin the run began at, so
// the lamplighter is posed at a point of neither zero nor round coordinates.
// A build that spawns on a ring about the origin passes at `(0, 0)` and fails
// here, which is the point of posing it.
//
// THE DRIVE. Window 0 with the timer at 0 and `spawning` alone on, for eight
// spawns: a full second apart at that window's interval, and eight of them
// under the window's cap of 20 with nothing else alive.
//
// THE TOLERANCE. `REAL_EPS`. The build reaches the point through a cosine and
// a sine of a random angle and the check reads it back through a hypotenuse,
// which is three real operations on a figure of 760, so the reading rounds by
// a few parts in a thousand billion; a billionth of a unit is far above that
// and far below any placement error a build could make.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, SPAWN_DISTANCE, SPAWN_WINDOWS, ticksOf } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, poseWindow } from "./spawns";

/** Where the lamplighter stands: neither the origin nor a round point. */
const PLAYER_X = 137.5;
const PLAYER_Y = -211.25;

/** Spawns read, and the ticks that covers at window 0's one-second interval. */
const SPAWNS = 8;
const BUDGET_TICKS = SPAWNS * ticksOf(SPAWN_WINDOWS[0]!.interval) + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("places every window spawn exactly SPAWN_DISTANCE from the lamplighter on its spawn tick", async () => {
  isolate(h);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  poseWindow(h, 0);
  enable(h, "spawning");

  const drive = await driveArrivals(h, BUDGET_TICKS, { stopAfter: SPAWNS });
  captureStill(h, "ring");

  assertEqual(
    drive.arrivals.length,
    SPAWNS,
    `the window spawns the director landed within ${BUDGET_TICKS} ticks`,
  );
  for (const arrival of drive.arrivals) {
    assertNear(
      distance(arrival.enemy, arrival.player),
      SPAWN_DISTANCE,
      REAL_EPS,
      `the spawn on tick ${arrival.tick}: its distance from the lamplighter's center`,
    );
  }
});
