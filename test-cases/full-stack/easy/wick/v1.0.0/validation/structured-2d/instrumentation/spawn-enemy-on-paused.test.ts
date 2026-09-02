// Wick — instrumentation/spawn-enemy-on-paused: `spawnEnemy('moth', 200, 0)`
// issued on `paused` appears at (200, 0), and on resuming it first moves on
// the next tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnEnemy(type, x, y)`: "Applies on `playing` and `paused`"; "a posed
// enemy ... first moves ... on the next tick". `specs/enemies.md`, "Chase":
// one tick's step is `speed × TICK_DT` toward the lamplighter, 100/60 for a
// moth, so from (200, 0) it reads `200 − 100 × TICK_DT` (`MOTION_EPS`).
//
// THE DRIVE. An isolated run posed to `paused`, the spawn read at the call,
// `enemyMotion` on, `setScreen("playing")` to resume, and one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { ENEMIES, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemy,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns on paused and moves on the first tick after resuming", async () => {
  isolate(h);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "screen before the spawn");
  const id = placeEnemy(h, "moth", 200, 0);
  const posed = enemyById(h.snapshot(), id);
  await h.frameDraw();
  captureStill(h, "paused");
  assertDefined(posed, "the moth spawned on paused");
  assertEqual(posed?.x, 200, "its x at the call");
  assertEqual(posed?.y, 0, "its y at the call");

  enable(h, "enemyMotion");
  h.debug.setScreen("playing");
  const moved = enemyById(await advanceTicks(h, 1), id);
  assertDefined(moved, "the moth after the first tick");
  assertNear(
    moved?.x ?? Number.NaN,
    200 - ENEMIES.moth.speed * TICK_DT,
    MOTION_EPS,
    "its x after one chasing tick",
  );
  assertEqual(moved?.y, 0, "its y after one chasing tick");
});
