// director/swarm-4-00 — the 4:00 gnat swarm fires on tick 14400
// and on no other.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events"): "Each
// fires once per run, on exactly the tick the run clock equals its time
// (`tick == time * TICK_HZ`, read after the tick's clock has risen), and only
// while `events` is on". Its row of `EVENTS` reads
//
// | 4:00 | 240 | Gnat swarm |
//
// so the tick is `240 × TICK_HZ`, 14400. What the run keeps of it is
// `firedEvents`, "the times that have fired, in ascending order whatever order
// they fired in", reported by the snapshot as "run-clock seconds, ascending"
// (specs/instrumentation.md).
//
// WHAT ARRIVES. "A gnat swarm spawns `SWARM_SIZE` (`24`) gnats on the same tick
// along a line perpendicular to a direction `d`" (specs/enemies.md — "Scripted
// events"). This point reads the count and the type on the right tick; where
// on the line each gnat sits is `swarm-geometry`, which way they head is
// `swarm-heading`, and their health is `swarm-gnats-scaled`.
//
// WHY THE TICK BEFORE IS READ TOO. "Exactly the tick" rules out a build that
// fires as soon as the clock has passed the time as firmly as one that never
// fires, so tick 14399 is run first and must spawn nothing. `director/events.ts`
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
import { EVENTS, SWARM_SIZE } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { carryAcross, isolateForEvents } from "./events";

/** This event's row of `EVENTS`. */
const EVENT = EVENTS.find((event) => event.seconds === 240)!;

/** How many enemies the event spawns. */
const ARRIVALS = SWARM_SIZE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns 24 gnats on tick 14400 and none on the tick before", async () => {
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
    assertEqual(arrival.type, "gnat", "the type the event spawned");
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
