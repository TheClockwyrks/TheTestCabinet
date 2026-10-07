// director/cap-room-spawns-at-once — the first tick with room under the cap
// spawns, with no interval waited out.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn timer"): "When the cap is full the timer
//     rests at `0`, and the next spawn lands on the first tick that has room."
//   - `specs/world.md` ("Timers"): "a timer at `0` stays due on every tick
//     until it is set again."
//   - `specs/enemies.md` ("Windows"): row 0 applies from 0:00 with a cap of 20.
//   - `specs/instrumentation.md` (`removeEnemy`): "Removes enemy `id`. Nothing
//     drops, nothing counts as a kill, and no cue plays."
//
// WHAT IS READ. Twenty moths are posed, the cap is held for two intervals so
// the timer is resting at 0, then one moth is removed and one tick is run: an
// enemy must be on the field again on that very tick. A build that restarts the
// interval when the cap clears waits 60 ticks and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on, so the crowd is
// inert and `aliveCommons` changes only where the check changes it. The
// removal is the surface's, which drops nothing and counts nothing, so the tick
// that follows differs from the ticks before it in the cap alone.
//
// TOLERANCE. None: a count of enemies on one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { SPAWN_WINDOWS, ticksFor } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { poseRing, poseWindow } from "./stage";

const ROW = SPAWN_WINDOWS[0];

/** Two intervals at the cap, long enough that the timer is resting at 0. */
const RESTING_TICKS = 2 * ticksFor(ROW.interval);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns on the first tick that has room under the cap", async () => {
  isolate(h);
  enable(h, "spawning");
  poseWindow(h, 0);
  const posed = poseRing(h, "moth", ROW.cap);

  const resting = await h.tick(RESTING_TICKS);
  assertLength(resting.run.enemies, ROW.cap, "enemies while the cap is met");
  assertEqual(resting.run.spawnTimer, 0, "the spawn timer resting at the cap");

  const before = h.snapshot().run.nextId;
  h.debug.removeEnemy(posed[0]);
  const after = await h.tick(1);
  captureStill(h, "room");

  assertLength(
    after.run.enemies,
    ROW.cap,
    "enemies on the first tick with room",
  );
  assertGreaterThan(
    after.run.enemies.filter((enemy) => enemy.id >= before).length,
    0,
    "enemies spawned on the first tick with room",
  );
});
