// director/mothwing-2-00 — the 2:00 scripted event fires on tick 7200 and on
// no tick before it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Scripted events"): "`EVENTS` lists the night's
//     scripted spawns in time order. Each fires once per run, on exactly the
//     tick the run clock equals its time (`tick == time * TICK_HZ`, read after
//     the tick's clock has risen), and only while `events` is on", and the
//     table's row reads "| 2:00 | 120 | Mothwing spawns at a spawn point |".
//   - `specs/enemies.md` ("The spawn ring"): "A spawn point is
//     `SPAWN_DISTANCE` (`760`) units from the lamplighter's center at an angle
//     drawn uniformly over the full circle", which is where the event
//     places what it spawns.
//   - `specs/enemies.md` ("Scripted events"): "`firedEvents` lists the times
//     that have fired, in ascending order whatever order they fired in."
//   - `specs/world.md` ("One tick"), phase 10: the director runs on the tick,
//     "then the scripted events while `events` is on".
//
// WHAT IS READ. The clock is posed two ticks short of 7200 and two ticks are
// run. The first reaches tick 7199: the field must still be empty and
// `firedEvents` must still be empty, because an event fires on its exact tick
// and on no other. The second reaches tick 7200: exactly one enemy must be on
// the field, of type `mothwing`, and `firedEvents` must hold 120 alone. A
// build that fires an event on any tick at or past its time fires on the first
// of the two.
//
// WHY THE NIGHT IS POSED AS IT IS. `events` alone is on: the window timer adds
// nothing, so everything on the field on the second tick came from the event;
// nothing moves, so what is read sits where the event put it; and nothing is
// removed by distance, so a spawn on the ring is not taken away before it is
// read.
//
// TOLERANCE. None: counts of enemies, a tick the specification states exactly,
// and the times `firedEvents` lists.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { EVENTS, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { crossEvent, enemiesOfType } from "./stage";

/** The event this check reads: row 1 of `EVENTS`, at 2:00. */
const EVENT = EVENTS[1];

/** The tick it fires on: `time * TICK_HZ`, 7200. */
const EVENT_TICK = EVENT.time * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the 2:00 event on tick 7200 and not before", async () => {
  isolate(h);
  enable(h, "events");

  const pair = await captureReplay(h, "event", () => crossEvent(h, EVENT.time));

  assertEqual(
    pair.before.run.tick,
    EVENT_TICK - 1,
    "the tick before the event",
  );
  assertLength(pair.before.run.enemies, 0, "enemies on the tick before");
  assertDeepEqual(
    pair.before.run.firedEvents,
    [],
    "firedEvents on the tick before",
  );

  assertEqual(pair.on.run.tick, EVENT_TICK, "the tick the event fires on");
  assertLength(pair.on.run.enemies, 1, "enemies on the event's tick");
  assertLength(
    enemiesOfType(pair.on, "mothwing"),
    1,
    "the mothwing the event spawned",
  );
  assertDeepEqual(
    pair.on.run.firedEvents,
    [EVENT.time],
    "firedEvents after the event fired",
  );
});
