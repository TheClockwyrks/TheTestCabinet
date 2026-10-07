// instrumentation/set-next-spawn-type-consumed — the window spawn that takes a
// posed type consumes it, so `nextSpawnType` reads `null` afterwards.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md` ("Drawn
// outcomes"): each value "is `null` on the idle run and after the draw that
// consumed it ... and is consumed by one draw alone"; `setNextSpawnType`:
// "that spawn consumes it".
//
// WHY THE NIGHT IS POSED AS IT IS. As `set-next-spawn-type`: an isolated night
// in window 2, whose row lists the posed `bat`, the timer posed due, and
// `spawning` on for one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { SPAWN_WINDOW, TICK_HZ, type EnemyId } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** The window the spawn is posed into: row 2, "moth, bat, rat". */
const WINDOW = 2;

const POSED_TYPE: EnemyId = "bat";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads null once the window spawn has taken the posed type", async () => {
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
  captureStill(h, "consumed");

  assertLength(spawned.run.enemies, 1, "enemies the due tick spawned");
  const [arrival] = spawned.run.enemies;
  assertEqual(arrival.type, POSED_TYPE, "the type of the window spawn");
  assertNull(spawned.run.nextSpawnType, "nextSpawnType after the spawn");
});
