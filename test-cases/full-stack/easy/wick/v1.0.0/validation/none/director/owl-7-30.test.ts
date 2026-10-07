// director/owl-7-30 — the 7:30 Owl fires on tick 27000
// and on no other.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events"): "Each
// fires once per run, on exactly the tick the run clock equals its time
// (`tick == time * TICK_HZ`, read after the tick's clock has risen), and only
// while `events` is on". Its row of `EVENTS` reads
//
// | 7:30 | 450 | Owl spawns at a spawn point |
//
// so the tick is `450 × TICK_HZ`, 27000. What the run keeps of it is
// `firedEvents`, "the times that have fired, in ascending order whatever order
// they fired in", reported by the snapshot as "run-clock seconds, ascending"
// (specs/instrumentation.md).
//
// WHAT ARRIVES. The row's own words, "Owl spawns at a spawn point": one enemy of
// that type on that tick. This point reads the count and the type; that it
// arrived on the spawn ring is `elites-spawn-at-spawn-point`.
//
// WHY THE TICK BEFORE IS READ TOO. "Exactly the tick" rules out a build that
// fires as soon as the clock has passed the time as firmly as one that never
// fires, so tick 26999 is run first and must spawn nothing. `director/events.ts`
// states the crossing in full.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone: the
// window timer would put its own spawns on these ticks and they would be
// indistinguishable from the event's, and nothing may move, hit or be removed
// before it is read. The clock is posed rather than run up to, so `firedEvents`
// holds nothing when the crossing begins and the list read after it is a
// reading of this event alone.
//
// THE TOLERANCE. A whole tick, whole counts, type names and a list of whole
// seconds, all read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { EVENTS } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { carryAcross, isolateForEvents } from "./events";

/** This event's row of `EVENTS`. */
const EVENT = EVENTS.find((event) => event.seconds === 450)!;

/** How many enemies the event spawns. */
const ARRIVALS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns one owl on tick 27000 and none on the tick before", async () => {
  await isolateForEvents(h);

  const crossing = await captureReplay(h, "event", () =>
    carryAcross(h, EVENT.tick),
  );

  assertEqual(
    crossing.edge.run.tick,
    EVENT.tick - 1,
    "the tick before the event's",
  );
  assertEqual(
    crossing.early.length,
    0,
    `enemies tick ${EVENT.tick - 1} spawned`,
  );
  assertEqual(
    crossing.fired.run.tick,
    EVENT.tick,
    "the tick the event fired on",
  );
  assertEqual(
    crossing.arrivals.length,
    ARRIVALS,
    `enemies tick ${EVENT.tick} spawned`,
  );
  for (const arrival of crossing.arrivals) {
    assertEqual(arrival.type, "owl", "the type the event spawned");
  }
  assertDeepEqual(
    crossing.edge.run.firedEvents,
    [],
    `firedEvents on tick ${EVENT.tick - 1}`,
  );
  assertDeepEqual(
    crossing.fired.run.firedEvents,
    [EVENT.seconds],
    `firedEvents on tick ${EVENT.tick}`,
  );
  assertTrue(
    crossing.fired.run.firedEvents.every(
      (at, index, all) => index === 0 || all[index - 1]! <= at,
    ),
    "firedEvents in ascending order",
  );
});
