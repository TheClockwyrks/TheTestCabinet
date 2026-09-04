// director/swarm-geometry — a swarm's gnats sit on the line the formula gives.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events"): "A gnat
// swarm spawns `SWARM_SIZE` (`24`) gnats on the same tick along a line
// perpendicular to a direction `d` ... The line is `SWARM_LINE` (`720`) units
// long, centered `SPAWN_DISTANCE` from the lamplighter along `d`, and the gnats
// are evenly spaced along it with one at each end:
//
//   center  = player + d * SPAWN_DISTANCE
//   perp    = (-dy, dx)
//   spacing = SWARM_LINE / (SWARM_SIZE - 1)
//   gnat i  = center + perp * (i - (SWARM_SIZE - 1) / 2) * spacing
//
// for `i` from `0` to `SWARM_SIZE - 1`." The reading is taken on the spawn tick,
// because specs/world.md ("One tick", phase 10) says an enemy spawned on a tick
// "sits at its spawn point and first moves on the next tick".
//
// THE FOUR FIGURES READ. The line's center stands `SPAWN_DISTANCE` (760) from
// the lamplighter. Every gnat lies on the line, its component along `d` being
// zero from the center. The twenty-four offsets across the line are exactly
// `(i − 11.5) × spacing`, so they are evenly spaced with `spacing` between
// neighbours. And the two ends are `SWARM_LINE` (720) apart, which the offsets
// give but is read on its own because it is the figure the specification names.
//
// HOW `d` IS RECOVERED. `director/swarms.ts` states it: the mean of the
// twenty-four positions is the line's center, because the offsets sum to zero,
// and `d` is the unit vector to it. No angle is assumed, because the angle is
// "drawn uniformly from the seeded generator" and the specification fixes no
// value for it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone: the
// window timer's own spawns would land among the gnats and be read as part of
// the line, and nothing may move before the line is measured.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` a position is allowed. The figures
// are `cos` and `sin` of one angle scaled by 760 and 720, and the mean of
// twenty-four of them, whose float error is around `1e-12`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  POSITION_TOL,
  SPAWN_DISTANCE,
  SWARM_LINE,
  SWARM_SIZE,
  SWARM_SPACING,
} from "../constants";
import {
  captureStill,
  createHarness,
  distanceBetween,
  type Harness,
} from "../harness";
import { poseSwarm } from "./swarms";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lines the 24 gnats up 720 units across, centered 760 units out", async () => {
  const swarm = await poseSwarm(h);
  await captureStill(h, "line");

  assertNear(
    distanceBetween(swarm.center, swarm.at),
    SPAWN_DISTANCE,
    POSITION_TOL,
    "the distance from the lamplighter to the swarm line's center",
  );

  const across: number[] = [];
  for (const gnat of swarm.gnats) {
    const dx = gnat.x - swarm.center.x;
    const dy = gnat.y - swarm.center.y;
    assertNear(
      dx * swarm.direction.x + dy * swarm.direction.y,
      0,
      POSITION_TOL,
      `a gnat's distance from the line, along the swarm's direction`,
    );
    across.push(dx * swarm.perp.x + dy * swarm.perp.y);
  }
  across.sort((a, b) => a - b);

  for (const [at, offset] of across.entries()) {
    assertNear(
      offset,
      (at - (SWARM_SIZE - 1) / 2) * SWARM_SPACING,
      POSITION_TOL,
      `the offset along the line of the gnat ${at + 1} places from its near end`,
    );
  }
  assertNear(
    across[SWARM_SIZE - 1]! - across[0]!,
    SWARM_LINE,
    POSITION_TOL,
    "the distance between the two gnats at the line's ends",
  );
});
