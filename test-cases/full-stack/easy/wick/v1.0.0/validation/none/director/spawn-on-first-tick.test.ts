// director/spawn-on-first-tick — a run's very first tick spawns.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The spawn timer"):
// "`spawnTimer` is a timer as `specs/world.md` defines one. It is set to `0`
// when a run starts", and the order it runs in leaves a timer at `0` due on the
// tick that reads it — specs/world.md ("Timers"): "A timer is due on every tick
// on which it is `0` after its count-down". The same paragraph draws the
// conclusion out loud: "A spawn therefore lands on the first tick of a run".
// What arrives is row 0's, "| 0 | 0:00 | moth | 1.00 | 20 |", whose types
// column holds `moth` alone, so the type is decided rather than drawn.
//
// WHY THE TIMER IS NOT POSED. Every other point in this directory poses the
// timer to `0` to reach a due tick. This one is ABOUT the value a fresh run
// leaves there, so posing it would assert nothing: the run is opened and the
// first tick is run with the timer exactly as the build set it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone.
// The isolation runs after the run is opened and touches the clock and the
// timer not at all — it clears the field, empties the slots and holds the other
// six faculties — so the tick that follows is the run's first, at tick 0, with
// an empty field, and the moth read off it came from the director.
//
// THE TOLERANCE. A count of arrivals and a type name, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPAWN_WINDOWS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

/** The one type row 0 of `SPAWN_WINDOWS` spawns. */
const FIRST_TYPE = SPAWN_WINDOWS[0]!.types[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns one moth on the first playing tick of a fresh run", async () => {
  const opened = await isolate(h, { on: ["spawning"] });
  assertEqual(opened.run.tick, 0, "the clock a fresh run opens on");

  const first = await h.step(1);
  await captureStill(h, "first");

  const arrivals = newEnemies(opened, first);
  assertEqual(arrivals.length, 1, "enemies the run's first tick spawned");
  assertEqual(
    arrivals[0]!.type,
    FIRST_TYPE,
    "the type the run's first tick spawned",
  );
});
