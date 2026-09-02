// Wick — instrumentation/spawn-enemy-on-paused: `spawnEnemy("moth", 200, 0)`
// issued on `paused` appears in the snapshot at `(200, 0)`, and on resuming
// it first moves on the next tick.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnEnemy(type, x, y)`): "Applies on `playing` and `paused`"; "a posed
// enemy ... first moves ... on the next tick, exactly as one a tick created".
// specs/enemies.md — "Chase": "Each tick a chasing enemy ... advances one
// step along" its heading, so the moth's position after the resumed tick is
// not the posed one.
//
// WHY THE WORLD IS POSED AS IT IS. The run is paused by its `setScreen` row
// before the spawn, and resumed by the row that "Resumes exactly as `pause`
// on `paused` does"; `enemyMotion` alone is turned on for the one tick after,
// so the only thing that can move the moth is its own chase.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotEqual } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  poseScreen,
  type Harness,
} from "../harness";

const AT = { x: 200, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("applies on paused, and the spawn first moves on the resumed tick", async () => {
  await isolate(h);
  const paused = await poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the spawn is issued on");

  const moth = await placeEnemy(h, "moth", AT.x, AT.y);
  await captureStill(h, "paused");
  assertNear(moth.x, AT.x, POSITION_TOL, "the spawn's x on paused");
  assertNear(moth.y, AT.y, POSITION_TOL, "the spawn's y on paused");

  await poseScreen(h, "playing");
  await h.debug.setEnemyMotion(true);
  const moved = await h.step(1);
  const now = mustEnemy(moved, moth.id);
  assertNotEqual(
    `${now.x},${now.y}`,
    `${moth.x},${moth.y}`,
    "the spawn's position after the resumed tick",
  );
});
