// Wick — instrumentation/set-next-spawn-angle-consumed: the spawn that lands
// at a posed angle consumes it, so `nextSpawnAngle` reads `null` afterwards.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes"): each value "is `null` on the idle run and after the draw that
// consumed it ... and is consumed by one draw alone"; `setNextSpawnAngle`:
// "that spawn consumes it".
//
// WHY THE WORLD IS POSED AS IT IS. As `set-next-spawn-angle`: an isolated
// night in window 0, the timer posed due, `spawning` on for one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

const POSED_ANGLE = 210;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads null once the spawn has taken the posed angle", async () => {
  await isolate(h);
  await h.debug.setNextSpawnAngle(POSED_ANGLE);
  await h.debug.setSpawnTimer(0);
  await h.debug.setSpawning(true);
  const posed = await h.snapshot();
  assertEqual(
    posed.run.nextSpawnAngle,
    POSED_ANGLE,
    "nextSpawnAngle before the spawn",
  );

  const spawned = await h.step(1);
  await captureStill(h, "consumed");

  assertLength(newEnemies(posed, spawned), 1, "enemies the due tick spawned");
  assertNull(spawned.run.nextSpawnAngle, "nextSpawnAngle after the spawn");
});
