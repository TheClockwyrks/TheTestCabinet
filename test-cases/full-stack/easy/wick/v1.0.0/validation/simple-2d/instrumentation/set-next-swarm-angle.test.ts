// instrumentation/set-next-swarm-angle — `setNextSwarmAngle(30)` on `playing`
// sets `nextSwarmAngle` to 30, the snapshot reads it back, and the next gnat
// swarm is centered along that direction with every gnat heading back along
// it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `setNextSwarmAngle(degrees)`): "The next gnat swarm's direction `d` is the
// unit vector at that angle". specs/enemies.md ("Scripted events"): "`center
// = player + d * SPAWN_DISTANCE`" and "Every gnat in the swarm spawns with
// heading `-d`".
//
// THE POSE. An isolated night with `events` alone, carried across the 1:00
// swarm's tick by the shared `crossEvent`; `d` is recovered from the gnats
// themselves through `swarmCenter` and read against the angle that was posed.
//
// THE TOLERANCE. `MOTION_TOLERANCE` on the center, `cos` and `sin` of one
// angle scaled by 760 and averaged over twenty-four gnats; `DIRECTION_TOLERANCE`
// on each heading, a unit vector.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNull, assertWithin } from "../assert";
import {
  DIRECTION_TOLERANCE,
  EVENTS,
  MOTION_TOLERANCE,
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
import { crossEvent, enemiesOfType, swarmCenter } from "../director/stage";

const SWARM_TIME = EVENTS[0].time;
const POSED_ANGLE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("poses the next swarm's direction, and the swarm comes that way", async () => {
  isolate(h);
  enable(h, "events");
  h.debug.setNextSwarmAngle(POSED_ANGLE);
  const pair = await crossEvent(h, SWARM_TIME);
  captureStill(h, "swarm");

  const gnats = enemiesOfType(pair.on, "gnat");
  assertLength(gnats, SWARM_SIZE, "the swarm's gnats");
  const { player } = pair.on.run;
  const center = pointAt(player, SPAWN_DISTANCE, POSED_ANGLE);
  const read = swarmCenter(gnats);
  assertWithin(read.x, center.x, MOTION_TOLERANCE, "the line's center x");
  assertWithin(read.y, center.y, MOTION_TOLERANCE, "the line's center y");
  const back = pointAt({ x: 0, y: 0 }, 1, POSED_ANGLE + 180);
  for (const gnat of gnats) {
    assertWithin(
      gnat.heading.x,
      back.x,
      DIRECTION_TOLERANCE,
      `gnat ${gnat.id}'s heading x, back along the posed direction`,
    );
    assertWithin(
      gnat.heading.y,
      back.y,
      DIRECTION_TOLERANCE,
      `gnat ${gnat.id}'s heading y, back along the posed direction`,
    );
  }
  assertNull(
    pair.on.run.nextSwarmAngle,
    "nextSwarmAngle once the swarm took it",
  );
});
