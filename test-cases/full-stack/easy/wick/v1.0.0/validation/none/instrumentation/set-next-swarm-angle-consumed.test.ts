// Wick — instrumentation/set-next-swarm-angle-consumed: a posed swarm angle is
// read back until the swarm takes it, and reads `null` after.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes"): each value "is `null` on the idle run and after the draw that
// consumed it ... and is consumed by one draw alone"; `setNextSwarmAngle`:
// "that swarm consumes it". A window spawn draws no swarm direction, so it
// leaves the pose standing.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone; a
// window spawn is landed first with `spawning` on for one tick, then the night
// is carried across the 1:00 swarm's tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  newEnemies,
  type Harness,
} from "../harness";
import { isolateForEvents } from "../director/events";
import { readSwarm } from "../director/swarms";

const POSED_ANGLE = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands across a window spawn and reads null once the swarm took it", async () => {
  await isolateForEvents(h);
  await h.debug.setNextSwarmAngle(POSED_ANGLE);
  await h.debug.setSpawnTimer(0);
  await h.debug.setSpawning(true);
  const before = await h.snapshot();
  const spawned = await h.step(1);
  await h.debug.setSpawning(false);
  assertLength(
    newEnemies(before, spawned),
    1,
    "enemies the window spawn added",
  );
  assertEqual(
    spawned.run.nextSwarmAngle,
    POSED_ANGLE,
    "nextSwarmAngle after a window spawn, which draws no swarm direction",
  );
  await h.debug.clearEnemies();

  const swarm = await readSwarm(h);
  await captureStill(h, "consumed");
  assertNull(swarm.fired.run.nextSwarmAngle, "nextSwarmAngle after the swarm");
});
