// instrumentation/set-next-spawn-type — `setNextSpawnType("rat")` on `playing`
// sets `nextSpawnType` to `rat`, the snapshot reads it back, and the next
// window spawn is a rat.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md` ("Drawn outcomes", `setNextSpawnType(id)`):
//     "Sets `nextSpawnType` to `id`, an enemy id of `specs/enemies.md` ... The
//     next window spawn is of that type in place of the type drawn from the
//     window's types, and that spawn consumes it."
//   - `specs/enemies.md` ("Windows"): row 2 reads "moth, bat, rat", so `rat`
//     is a type the row lists and a uniform draw over the row lands on it only
//     a third of the time.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night posed into window 2 with
// an empty field and the timer due, so the first tick with `spawning` on lands
// one window spawn, and that spawn is the one the pose decides.
//
// TOLERANCE. None: a type name and a count of arrivals.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
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

/** The window the spawn is posed into: row 2, "moth, bat, rat". */
const WINDOW = 2;

/** The posed type: the last of the row's three. */
const POSED_TYPE: EnemyId = "rat";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the next window spawn's type, and the spawn is of it", async () => {
  assertContains(
    SPAWN_WINDOWS[WINDOW].types,
    POSED_TYPE,
    `the types row ${WINDOW} of SPAWN_WINDOWS lists`,
  );
  isolate(h);
  h.debug.setTick(WINDOW * SPAWN_WINDOW * TICK_HZ);
  h.debug.setNextSpawnType(POSED_TYPE);
  assertEqual(
    h.snapshot().run.nextSpawnType,
    POSED_TYPE,
    "nextSpawnType after the pose",
  );

  h.debug.setSpawnTimer(0);
  enable(h, "spawning");
  const spawned = await h.tick(1);
  captureStill(h, "spawned");

  assertLength(spawned.run.enemies, 1, "enemies the due tick spawned");
  const [arrival] = spawned.run.enemies;
  assertEqual(arrival.type, POSED_TYPE, "the type of the window spawn");
});
