// director/second-mothwing-with-first-alive — the 5:00 Mothwing arrives while
// the 2:00 one is still on the field.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events"): "The
// second Mothwing spawns whether or not the first is still alive, so two can be
// on the field at once." The two rows of `EVENTS` are
// "| 2:00 | 120 | Mothwing spawns at a spawn point |" and
// "| 5:00 | 300 | Mothwing spawns at a spawn point |", firing on ticks
// `120 × TICK_HZ` and `300 × TICK_HZ`, 7200 and 18000.
//
// WHAT THE READING SEPARATES. A build that treated the elite as a singleton —
// that skipped the second row while one was alive, or replaced the first — puts
// one mothwing on the field and fails. A build that spawns the second
// regardless puts two there, and the two carry different ids, since an enemy
// "spawns with the next id from `nextId`, so ids ascend in spawn order and each
// is used once per run".
//
// WHY THE FIRST IS STILL ALIVE. It is never killed and never removed: the
// elites are outside the despawn rule ("Elites and the Dark are outside this
// rule and stay on the field at any distance"), `enemyMotion` is off so it
// cannot walk into the lamplighter, and no weapon is held. So the field at the
// second crossing holds exactly what the first crossing put there.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone, so
// the window timer adds nothing to either tick, and each crossing runs the tick
// before the event as well, as `director/events.ts` states.
//
// THE TOLERANCE. Whole counts and ids, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { EVENTS } from "../constants";
import {
  captureStill,
  createHarness,
  enemiesOf,
  type Harness,
} from "../harness";
import { carryAcross, isolateForEvents } from "./events";

/** The two Mothwing rows of `EVENTS`, in time order. */
const MOTHWINGS = EVENTS.filter((event) => event.kind === "mothwing");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts a second mothwing on the field with the first still alive", async () => {
  await isolateForEvents(h);
  const first = await carryAcross(h, MOTHWINGS[0]!.tick);
  assertEqual(
    first.arrivals.length,
    1,
    `mothwings tick ${MOTHWINGS[0]!.tick} spawned`,
  );

  const second = await carryAcross(h, MOTHWINGS[1]!.tick);
  await captureStill(h, "two");

  assertEqual(
    second.edge.run.enemies.filter((enemy) => enemy.type === "mothwing").length,
    1,
    `mothwings alive on the tick before ${MOTHWINGS[1]!.tick}`,
  );
  assertEqual(
    second.arrivals.length,
    1,
    `mothwings tick ${MOTHWINGS[1]!.tick} spawned`,
  );
  const alive = enemiesOf(second.fired, "mothwing");
  assertEqual(alive.length, 2, "mothwings on the field after the second event");
  assertNotEqual(alive[0]!.id, alive[1]!.id, "the second mothwing's id");
});
