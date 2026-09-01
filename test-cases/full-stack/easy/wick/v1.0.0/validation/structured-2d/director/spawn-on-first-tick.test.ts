// director/spawn-on-first-tick — the night opens with a spawn.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn timer": "`spawnTimer` ... is
// set to `0` when a run starts", and, of the rule that reads it, "A spawn
// therefore lands on the first tick of a run". `specs/world.md` ("Timers")
// says why: "A timer is due on every tick on which it is `0` after its
// count-down", and a count-down "that would leave it below `TICK_DT / 2`
// leaves it at exactly `0`" — so a timer standing at 0 is due on the very next
// tick. Window 0's row offers `moth` alone with a cap of 20, so the one enemy
// the first tick spawns is a moth.
//
// WHY THE TIMER IS NOT POSED. The requirement is that a RUN begins with the
// timer at 0, so posing it would decide the thing under test. `isolate` opens
// a fresh run through `setScreen("playing")`, which "Begins a fresh run
// exactly as `LIGHT THE LAMP` ... do" (`specs/instrumentation.md`), and the
// clears that follow it touch no timer; the check reads the timer the fresh
// run left and then runs one tick.
//
// THE DRIVE. One tick, with `spawning` alone on over an empty world at tick 0.
// A build whose timer starts anywhere above 0 spawns nothing on it.
//
// THE TOLERANCE. None: a count of enemies and a type name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPAWN_WINDOWS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** Window 0's only type, as row 0 of SPAWN_WINDOWS gives it. */
const [WINDOW_0_TYPE] = SPAWN_WINDOWS[0].types;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns one moth on the first playing tick of a fresh run", async () => {
  const posed = isolate(h);
  enable(h, "spawning");
  assertEqual(posed.run.spawnTimer, 0, "spawnTimer when a run starts");

  const after = await advanceTicks(h, 1);
  captureStill(h, "first");

  assertEqual(after.run.tick, 1, "the tick the drive reached");
  assertEqual(
    after.run.enemies.length,
    1,
    "the enemies alive after the first playing tick of a fresh run",
  );
  assertEqual(
    after.run.enemies[0]?.type,
    WINDOW_0_TYPE,
    "the type the first tick's spawn took, from row 0 of SPAWN_WINDOWS",
  );
});
