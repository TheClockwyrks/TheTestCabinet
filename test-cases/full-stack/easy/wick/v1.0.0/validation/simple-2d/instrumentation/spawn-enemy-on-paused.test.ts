// instrumentation/spawn-enemy-on-paused — `spawnEnemy('moth', 200, 0)` issued
// on paused appears in the snapshot at (200, 0), and on resuming it first
// moves on the next tick.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnEnemy`:
// "Applies on `playing` and `paused`"; "a posed enemy ... first moves ... on
// the next tick, exactly as one a tick created". specs/enemies.md, "Chase":
// one step is "`speed * TICK_DT` units" toward the lamplighter, the moth's
// speed 100.
//
// THE POSE. An isolated run paused through the surface, the spawn on paused,
// the read back, the resume through the surface with `enemyMotion` on, and
// one tick: the moth has stepped 100 × TICK_DT toward the origin.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertWithin } from "../assert";
import { ENEMIES, MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const AT = { x: 200, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spawns on paused and moves on the first tick after resuming", async () => {
  isolate(h);
  h.debug.setScreen("paused");
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen the spawn is issued on",
  );

  const id = spawnEnemyAt(h, "moth", AT.x, AT.y);
  const paused = h.snapshot();
  const spawned = enemyById(paused, id);
  assertDefined(spawned, "the moth in the snapshot on paused");
  assertEqual(spawned?.x, AT.x, "its x on paused");
  assertEqual(spawned?.y, AT.y, "its y on paused");

  enable(h, "enemyMotion");
  h.debug.setScreen("playing");
  const moved = await h.tick(1);
  captureStill(h, "paused");
  assertWithin(
    enemyById(moved, id)?.x ?? Number.NaN,
    AT.x - ENEMIES.moth.speed * TICK_DT,
    MOTION_TOLERANCE,
    "its x after the first tick on resuming",
  );
});
