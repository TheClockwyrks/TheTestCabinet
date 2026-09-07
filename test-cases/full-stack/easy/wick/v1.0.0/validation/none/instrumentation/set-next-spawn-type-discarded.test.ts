// Wick — instrumentation/set-next-spawn-type-discarded: a posed type the
// window's row does not list is discarded by the spawn, which draws from the
// row instead and reads `nextSpawnType` null afterwards.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextSpawnType(id)`): "A window spawn whose row does not list
// the type discards it and draws at random", and each posed value is "`null`
// ... after the draw that consumed it". specs/enemies.md ("Windows") lists
// row 0 as `moth` alone, so a spawn in window 0 that discards the posed
// `hound` can only be a moth.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night in window 0 with the
// timer posed due and `spawning` on for one tick, exactly as
// `set-next-spawn-type`, with a type the row does not list posed instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { SPAWN_WINDOWS, windowStartTick, type EnemyId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

/** The window the spawn is posed into: row 0, `moth` alone. */
const WINDOW = 0;

/** A type the row does not list. */
const POSED_TYPE: EnemyId = "hound";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns from the row when the posed type is not listed, and reads null", async () => {
  const row = SPAWN_WINDOWS[WINDOW]!;
  assertEqual(
    row.types.includes(POSED_TYPE),
    false,
    `row ${WINDOW} of SPAWN_WINDOWS leaving ${POSED_TYPE} unlisted`,
  );
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
  await captureStill(h, "discarded");

  const arrivals = newEnemies(posed, spawned);
  assertLength(arrivals, 1, "enemies the due tick spawned");
  assertEqual(
    row.types.includes(arrivals[0]!.type),
    true,
    `the spawn's type (${arrivals[0]!.type}) among row ${WINDOW}'s (${row.types.join(", ")})`,
  );
  assertNull(spawned.run.nextSpawnType, "nextSpawnType after the spawn");
});
