// director/swarm-geometry — a swarm stands in a line, evenly spaced, out on
// the ring.
//
// THE SPEC LINE. `specs/enemies.md`, "Scripted events": "A gnat swarm spawns
// `SWARM_SIZE` (`24`) gnats on the same tick along a line perpendicular to a
// direction `d`, a unit vector at an angle drawn uniformly over the full
// circle. The line is `SWARM_LINE` (`720`) units long, centered
// `SPAWN_DISTANCE` from the lamplighter along `d`, and the gnats are evenly
// spaced along it with one at each end:
//
//   center  = player + d * SPAWN_DISTANCE
//   perp    = (-dy, dx)
//   spacing = SWARM_LINE / (SWARM_SIZE - 1)
//   gnat i  = center + perp * (i - (SWARM_SIZE - 1) / 2) * spacing
//
// for `i` from `0` to `SWARM_SIZE - 1`."
//
// HOW `d` IS RECOVERED, SINCE IT IS RANDOM. The offsets in that formula run
// from `−(SWARM_SIZE − 1) / 2` to `+(SWARM_SIZE − 1) / 2` and sum to zero, so
// the mean of the gnats' centers is the line's center exactly, whatever angle
// was drawn, and `d` is the unit vector from the lamplighter to it. Every
// figure the specification fixes is then read in that frame: the center's
// distance from the lamplighter, each gnat's distance from the line along `d`,
// and each gnat's position along `perp`. Nothing here reads the angle itself,
// which the specification leaves to the draw.
//
// WHY THE LAMPLIGHTER STANDS AWAY FROM THE ORIGIN. `center` is written around
// `player`, so a build that lays its swarm about the origin passes at `(0, 0)`
// and fails here.
//
// WHEN THE LINE IS LEGIBLE. On the spawn tick alone: `specs/world.md` ("One
// tick", phase 10) has an enemy spawned on a tick sit "at its spawn point"
// that tick and move first on the next, so the drive is the one tick that
// crosses tick 3600 and the reading is that tick's snapshot. `enemyMotion` is
// off besides.
//
// THE TOLERANCE. `MOTION_EPS`, a millionth of a unit. The readings are sums
// and projections over 24 positions, each already the product of a cosine or
// a sine with 760, so the arithmetic rounds a few parts in a trillion; the
// bound is far above that and far below the 31.3 units the specification puts
// between neighbouring gnats.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  EVENTS,
  MOTION_EPS,
  SPAWN_DISTANCE,
  SWARM_LINE,
  SWARM_SIZE,
} from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick, swarmFrame } from "./spawns";

/** The 1:00 swarm, and the tick it fires on. */
const EVENT = EVENTS[0];
const FIRES_ON = eventTick(EVENT.time);

/** Where the lamplighter stands: neither the origin nor a round point. */
const PLAYER_X = -318.75;
const PLAYER_Y = 92.5;

/** The spacing the formula gives: `SWARM_LINE / (SWARM_SIZE - 1)`. */
const SPACING = SWARM_LINE / (SWARM_SIZE - 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lays the swarm's 24 gnats evenly along a 720-unit line centered 760 out", async () => {
  isolate(h);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  h.debug.setTick(FIRES_ON - 1);
  enable(h, "events");

  const drive = await driveArrivals(h, 1);
  captureStill(h, "line");

  assertEqual(
    drive.arrivals.length,
    SWARM_SIZE,
    `the gnats the ${EVENT.time} s swarm spawned`,
  );
  const player = drive.arrivals[0].player;
  const gnats = drive.arrivals.map((arrival) => arrival.enemy);
  const frame = swarmFrame(player, gnats);

  assertNear(
    distance(frame.center, player),
    SPAWN_DISTANCE,
    MOTION_EPS,
    "the line's center, from the lamplighter along d",
  );

  const across: number[] = [];
  for (const gnat of gnats) {
    const dx = gnat.x - frame.center.x;
    const dy = gnat.y - frame.center.y;
    assertNear(
      dx * frame.direction.x + dy * frame.direction.y,
      0,
      MOTION_EPS,
      `gnat ${gnat.id}: its distance from the line along d`,
    );
    across.push(dx * frame.perp.x + dy * frame.perp.y);
  }

  across.sort((a, b) => a - b);
  for (const [i, offset] of across.entries()) {
    assertNear(
      offset,
      (i - (SWARM_SIZE - 1) / 2) * SPACING,
      MOTION_EPS,
      `the gnat ${i} places along the line from its center`,
    );
  }
});
