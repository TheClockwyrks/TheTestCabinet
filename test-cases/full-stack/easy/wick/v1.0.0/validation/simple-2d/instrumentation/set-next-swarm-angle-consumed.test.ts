// instrumentation/set-next-swarm-angle-consumed — a posed swarm angle is read
// back until the swarm takes it, and reads `null` after.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes"):
// each value "is `null` on the idle run and after the draw that consumed it
// ... and is consumed by one draw alone"; `setNextSwarmAngle`: "that swarm
// consumes it". A window spawn draws no swarm direction, so it leaves the pose
// standing.
//
// THE POSE. An isolated night; a window spawn is landed first with `spawning`
// on for one tick, then the night is carried across the 1:00 swarm's tick with
// `events` alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { EVENTS, SWARM_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  disable,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { crossEvent, enemiesOfType } from "../director/stage";

const SWARM_TIME = EVENTS[0].time;
const POSED_ANGLE = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands across a window spawn and reads null once the swarm took it", async () => {
  isolate(h);
  h.debug.setNextSwarmAngle(POSED_ANGLE);
  h.debug.setSpawnTimer(0);
  enable(h, "spawning");
  const spawned = await h.tick(1);
  disable(h, "spawning");
  assertLength(spawned.run.enemies, 1, "enemies the window spawn added");
  assertEqual(
    spawned.run.nextSwarmAngle,
    POSED_ANGLE,
    "nextSwarmAngle after a window spawn, which draws no swarm direction",
  );
  h.debug.clearEnemies();

  enable(h, "events");
  const pair = await crossEvent(h, SWARM_TIME);
  captureStill(h, "consumed");
  assertLength(enemiesOfType(pair.on, "gnat"), SWARM_SIZE, "the swarm's gnats");
  assertNull(pair.on.run.nextSwarmAngle, "nextSwarmAngle after the swarm");
});
