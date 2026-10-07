// director/second-mothwing-with-first-alive — the 5:00 Mothwing comes whether
// or not the 2:00 one is dead.
//
// THE SPEC LINE. `specs/enemies.md`, "Scripted events": "The second Mothwing
// spawns whether or not the first is still alive, so two can be on the field
// at once." The table lists the two arrivals at 2:00 and 5:00, seconds 120 and
// 300, so their ticks are 7200 and 18000.
//
// WHAT A BUILD MIGHT DO INSTEAD. Treat the elite as a slot rather than an
// event — one mothwing at a time, the second suppressed or the first replaced
// — which the specification rules out in that sentence. Both the count and the
// two distinct ids are read, so a build that replaced the first rather than
// adding the second fails on the count, and one that reused the entity fails
// on the ids.
//
// THE DRIVE. The isolated world with `events` alone on. The clock is posed one
// tick short of each arrival in turn and stepped across it, and nothing is
// cleared between them, so the first mothwing is alive and on the field when
// the second fires. `enemyMotion` is off, so the first stands where it
// arrived; `enemyContact` is off, so it does no harm meanwhile.
//
// THE TOLERANCE. None: a count of mothwings and two ids.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotEqual } from "../assert";
import { EVENTS } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick } from "./spawns";

/** The 2:00 and 5:00 rows of EVENTS, and the ticks they fire on. */
const FIRST = EVENTS[1];
const SECOND = EVENTS[3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts a second mothwing on the field at 5:00 with the 2:00 one still alive", async () => {
  isolate(h);
  enable(h, "events");

  h.debug.setTick(eventTick(FIRST.time) - 1);
  const first = await driveArrivals(h, 1);
  h.debug.setTick(eventTick(SECOND.time) - 1);
  const second = await driveArrivals(h, 1);
  captureStill(h, "two");

  assertEqual(
    first.arrivals.length,
    1,
    `the enemies the ${FIRST.time} s event spawned`,
  );
  assertEqual(
    second.arrivals.length,
    1,
    `the enemies the ${SECOND.time} s event spawned with the first mothwing alive`,
  );
  assertNotEqual(
    second.arrivals[0]?.enemy.id,
    first.arrivals[0]?.enemy.id,
    "the id the second mothwing took",
  );
  assertLength(
    second.snapshot.run.enemies.filter((enemy) => enemy.type === "mothwing"),
    2,
    "the mothwings on the field after the second arrival",
  );
});
