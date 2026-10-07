// Wick — instrumentation/set-next-swarm-angle: `setNextSwarmAngle(30)` on
// `playing` sets `nextSwarmAngle` to 30, the snapshot reads it back, and the
// next gnat swarm is centered along that direction with every gnat heading
// back along it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes", `setNextSwarmAngle(degrees)`): "The next gnat swarm's
// direction `d` is the unit vector at that angle". `specs/enemies.md`
// ("Scripted events"): "`center = player + d * SPAWN_DISTANCE`" and "Every
// gnat in the swarm spawns with heading `-d`".
//
// THE POSE. An isolated night with `events` alone, carried across the 1:00
// swarm's tick; `d` is recovered from the gnats themselves through
// `swarmFrame` and read against the angle that was posed.
//
// THE TOLERANCE. `MOTION_EPS` on the center, `cos` and `sin` of one angle
// scaled by 760 and averaged over twenty-four gnats; `REAL_EPS` on each
// heading, a unit vector.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNull } from "../assert";
import {
  EVENTS,
  MOTION_EPS,
  REAL_EPS,
  SPAWN_DISTANCE,
  SWARM_SIZE,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  pointAt,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick, swarmFrame } from "../director/spawns";

/** The 1:00 swarm, and the tick it fires on. */
const FIRES_ON = eventTick(EVENTS[0].time);
const POSED_ANGLE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the next swarm's direction, and the swarm comes that way", async () => {
  isolate(h);
  h.debug.setTick(FIRES_ON - 1);
  enable(h, "events");
  h.debug.setNextSwarmAngle(POSED_ANGLE);
  assertEqual(
    h.snapshot().run.nextSwarmAngle,
    POSED_ANGLE,
    "nextSwarmAngle after the pose",
  );

  const drive = await driveArrivals(h, 1);
  captureStill(h, "swarm");

  assertEqual(drive.arrivals.length, SWARM_SIZE, "the swarm's gnats");
  const player = drive.arrivals[0].player;
  const gnats = drive.arrivals.map((arrival) => arrival.enemy);
  const expected = pointAt(player, POSED_ANGLE, SPAWN_DISTANCE);
  const { center } = swarmFrame(player, gnats);
  assertNear(center.x, expected.x, MOTION_EPS, "the line's center x");
  assertNear(center.y, expected.y, MOTION_EPS, "the line's center y");
  const back = pointAt({ x: 0, y: 0 }, POSED_ANGLE + 180, 1);
  for (const gnat of gnats) {
    assertNear(
      gnat.heading.x,
      back.x,
      REAL_EPS,
      `gnat ${gnat.id}'s heading x, back along the posed direction`,
    );
    assertNear(
      gnat.heading.y,
      back.y,
      REAL_EPS,
      `gnat ${gnat.id}'s heading y, back along the posed direction`,
    );
  }
  assertNull(
    drive.snapshot.run.nextSwarmAngle,
    "nextSwarmAngle once the swarm took it",
  );
});
