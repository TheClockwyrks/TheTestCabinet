// Wick — instrumentation/set-next-spawn-type-consumed: the window spawn that
// takes a posed type consumes it, so `nextSpawnType` reads `null` afterwards.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes"): each value "is `null` on the idle run and after the draw that
// consumed it ... and is consumed by one draw alone"; `setNextSpawnType`:
// "that spawn consumes it".
//
// WHY THE WORLD IS POSED AS IT IS. As `set-next-spawn-type`: an isolated night
// in window 2, whose row lists the posed `bat`, the timer posed due, and
// `spawning` on for one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { windowStartTick, type EnemyId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

/** The window the spawn is posed into: row 2, "moth, bat, rat". */
const WINDOW = 2;

const POSED_TYPE: EnemyId = "bat";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads null once the window spawn has taken the posed type", async () => {
  await isolate(h);
  await h.debug.setTick(windowStartTick(WINDOW));
  await h.debug.setNextSpawnType(POSED_TYPE);
  await h.debug.setSpawnTimer(0);
  await h.debug.setSpawning(true);
  const posed = await h.snapshot();
  assertEqual(
    posed.run.nextSpawnType,
    POSED_TYPE,
    "nextSpawnType before the spawn",
  );

  const spawned = await h.step(1);
  await captureStill(h, "consumed");

  const arrivals = newEnemies(posed, spawned);
  assertLength(arrivals, 1, "enemies the due tick spawned");
  assertEqual(arrivals[0]!.type, POSED_TYPE, "the type of the window spawn");
  assertNull(spawned.run.nextSpawnType, "nextSpawnType after the spawn");
});
