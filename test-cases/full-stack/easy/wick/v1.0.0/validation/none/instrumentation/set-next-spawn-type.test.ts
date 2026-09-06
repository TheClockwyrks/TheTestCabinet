// Wick — instrumentation/set-next-spawn-type: `setNextSpawnType("rat")` on
// `playing` sets `nextSpawnType` to `rat`, the snapshot reads it back, and the
// next window spawn is a rat.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextSpawnType(id)`): "Sets `nextSpawnType` to `id`, an enemy
// id of `specs/enemies.md` ... The next window spawn is of that type in place
// of the type drawn from the window's types, and that spawn consumes it."
// specs/enemies.md ("Windows") lists row 2 as "moth, bat, rat", so `rat` is a
// type that row lists and a uniform draw over the row lands on it only a third
// of the time.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night posed into window 2 with
// an empty field and the timer due, so the first tick with `spawning` on lands
// one window spawn, and that spawn is the one the pose decides.
//
// THE TOLERANCE. None: a type name and a count of arrivals.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SPAWN_WINDOWS, windowStartTick, type EnemyId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
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

afterEach(async () => {
  await h.dispose();
});

it("poses the next window spawn's type, and the spawn is of it", async () => {
  assertEqual(
    SPAWN_WINDOWS[WINDOW]!.types.includes(POSED_TYPE),
    true,
    `row ${WINDOW} of SPAWN_WINDOWS listing ${POSED_TYPE}`,
  );
  await isolate(h);
  await h.debug.setTick(windowStartTick(WINDOW));
  await h.debug.setNextSpawnType(POSED_TYPE);
  const posed = await h.snapshot();
  assertEqual(
    posed.run.nextSpawnType,
    POSED_TYPE,
    "nextSpawnType after the pose",
  );

  await h.debug.setSpawnTimer(0);
  await h.debug.setSpawning(true);
  const spawned = await h.step(1);
  await captureStill(h, "spawned");

  const arrivals = newEnemies(posed, spawned);
  assertLength(arrivals, 1, "enemies the due tick spawned");
  assertEqual(arrivals[0]!.type, POSED_TYPE, "the type of the window spawn");
});
