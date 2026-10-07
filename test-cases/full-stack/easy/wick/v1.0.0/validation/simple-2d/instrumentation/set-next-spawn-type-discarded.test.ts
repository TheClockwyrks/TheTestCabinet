// instrumentation/set-next-spawn-type-discarded — a posed type the window's
// row does not list is discarded by the spawn, which draws from the row
// instead and reads `nextSpawnType` null afterwards.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md` ("Drawn
// outcomes", `setNextSpawnType(id)`): "A window spawn whose row does not list
// the type discards it and draws at random", and each posed value is "`null`
// ... after the draw that consumed it". `specs/enemies.md` ("Windows") lists
// row 0 as `moth` alone, so a spawn in window 0 that discards the posed
// `hound` can only be a moth.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night in window 0 with the
// timer posed due and `spawning` on for one tick, exactly as
// `set-next-spawn-type`, with a type the row does not list posed instead.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertNotContains,
  assertNull,
} from "../assert";
import {
  SPAWN_WINDOW,
  SPAWN_WINDOWS,
  TICK_HZ,
  type EnemyId,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** The window the spawn is posed into: row 0, `moth` alone. */
const WINDOW = 0;

const ROW = SPAWN_WINDOWS[WINDOW];

/** A type the row does not list. */
const POSED_TYPE: EnemyId = "hound";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spawns from the row when the posed type is not listed, and reads null", async () => {
  assertNotContains(
    ROW.types,
    POSED_TYPE,
    `the types row ${WINDOW} of SPAWN_WINDOWS lists`,
  );
  isolate(h);
  h.debug.setTick(WINDOW * SPAWN_WINDOW * TICK_HZ);
  h.debug.setNextSpawnType(POSED_TYPE);
  h.debug.setSpawnTimer(0);
  enable(h, "spawning");
  assertEqual(
    h.snapshot().run.nextSpawnType,
    POSED_TYPE,
    "nextSpawnType before the spawn",
  );

  const spawned = await h.tick(1);
  captureStill(h, "discarded");

  assertLength(spawned.run.enemies, 1, "enemies the due tick spawned");
  const [arrival] = spawned.run.enemies;
  assertContains(ROW.types, arrival.type, "the type of the window spawn");
  assertNull(spawned.run.nextSpawnType, "nextSpawnType after the spawn");
});
