// director/swarm-7-00 — the third gnat swarm arrives at 7:00.
//
// THE SPEC LINE. `specs/enemies.md`, "Scripted events": "`EVENTS` lists the
// night's scripted spawns in time order. Each fires once per run, on exactly
// the tick the run clock equals its time (`tick == time * TICK_HZ`, read
// after the tick's clock has risen), and only while `events` is on". The
// table's 7:00 row is second `420`, so the tick it fires on
// is `420 × TICK_HZ` = `25200`. `firedEvents` "lists the times
// that have fired, in ascending order whatever order they fired in".
//
// WHAT A SWARM IS. `specs/enemies.md` ("Scripted events"): "A gnat swarm
// spawns `SWARM_SIZE` (`24`) gnats on the same tick along a line
// perpendicular to a direction `d`". This item decides that the swarm
// arrives, on its tick and no other, and that it is 24 gnats; where the line
// stands, which way it heads, and how much health its gnats carry are their
// own items.
//
// WHY THE CLOCK IS POSED TWO TICKS SHORT. "on exactly the tick" is a claim
// about two ticks, not one: the event must not fire on tick 25199 and
// must fire on tick 25200. So the clock is posed to 25198 and the drive
// steps one tick at a time, reading the field after each. A build that fires on
// the first tick at or past its time lands its arrivals a tick early and fails
// here.
//
// THE DRIVE. The isolated world with `events` alone on. `spawning` is off, so
// nothing the window timer would add is confused for the event's arrivals, and
// `despawning` and `enemyMotion` are off, so what arrives stays where it
// arrived. Posing the clock fires nothing by itself: "an event ... which the
// debug surface's `setTick` skips over, never fires", so the events before
// this one are absent from `firedEvents` rather than fired late.
//
// THE TOLERANCE. None: a count of arrivals, a type name, a whole tick, and a
// list of whole seconds.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertNotContains } from "../assert";
import { EVENTS, SWARM_SIZE, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick } from "./spawns";

/** The 7:00 row of EVENTS, and the tick it fires on. */
const EVENT = EVENTS[4];
const FIRES_ON = eventTick(EVENT.time);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns 24 gnats on tick 25200 and not on the tick before it", async () => {
  isolate(h);
  h.debug.setTick(FIRES_ON - 2);
  enable(h, "events");

  const { before, on } = await captureReplay(h, "event", async () => ({
    before: await driveArrivals(h, 1),
    on: await driveArrivals(h, 1),
  }));

  assertEqual(
    before.snapshot.run.tick,
    FIRES_ON - 1,
    "the tick the first step reached",
  );
  assertEqual(
    before.arrivals.length,
    0,
    `the enemies that arrived on tick ${FIRES_ON - 1}, the tick before the event's`,
  );
  assertNotContains(
    before.snapshot.run.firedEvents,
    EVENT.time,
    `firedEvents on tick ${FIRES_ON - 1}`,
  );

  assertEqual(
    on.snapshot.run.tick,
    FIRES_ON,
    "the tick the second step reached",
  );
  assertEqual(
    on.arrivals.length,
    SWARM_SIZE,
    `the enemies that arrived on tick ${FIRES_ON}, at run clock ${EVENT.time} s (${TICK_HZ} ticks a second)`,
  );
  for (const arrival of on.arrivals) {
    assertEqual(
      arrival.enemy.type,
      "gnat",
      `the type of the enemy the ${EVENT.time} s event spawned`,
    );
  }
  assertContains(
    on.snapshot.run.firedEvents,
    EVENT.time,
    `firedEvents after tick ${FIRES_ON}`,
  );
});
