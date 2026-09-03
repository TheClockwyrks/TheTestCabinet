// director/events-spawn-past-cap — the cap holds the timer, never an event.
//
// THE SPEC LINE. `specs/enemies.md`, "The cap": "The cap governs the timer's
// spawns alone; a scripted event spawns regardless of it." The same section
// says of the three uncounted kinds that "they spawn whether or not it is
// full", and "Scripted events" puts no condition of any kind on an event
// beyond its tick and the `events` switch.
//
// HOW THE CAP IS MADE FULL. `aliveCommons` is "the number of live enemies of
// rank `common` other than gnats", so the field is posed with exactly the cap
// of the window the event fires in: the 1:00 swarm fires on tick 3600, whose
// run clock of 60 s puts it in window 2 by
// `min(19, floor(time / SPAWN_WINDOW))`, and row 2 of `SPAWN_WINDOWS` caps
// that window at 40. With `aliveCommons` at the cap, `aliveCommons < cap` is
// false on every tick, which is the exact condition the timer's spawn is
// under and the event's is not.
//
// THE DRIVE. The isolated world with `events` alone on and one tick from a
// clock posed at 3599. `spawning` is off, so a build whose cap arithmetic is
// wrong fails the cap items rather than this one, and every arrival on the
// tick is the event's.
//
// THE TOLERANCE. None: a count of arrivals and a type name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { EVENTS, SPAWN_WINDOWS, SWARM_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick, fillCommons } from "./spawns";

/** The 1:00 swarm, and the tick it fires on. */
const EVENT = EVENTS[0];
const FIRES_ON = eventTick(EVENT.time);

/** The cap of window 2, the window tick 3600 falls in. */
const CAP = SPAWN_WINDOWS[2].cap;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns the 1:00 swarm's 24 gnats over a field already at its window's cap", async () => {
  isolate(h);
  fillCommons(h, CAP);
  h.debug.setTick(FIRES_ON - 1);
  enable(h, "events");

  const posed = h.snapshot();
  const after = await driveArrivals(h, 1);
  captureStill(h, "past");

  assertEqual(
    posed.run.aliveCommons,
    CAP,
    `aliveCommons with the cap of window ${posed.run.spawnWindow} posed alive`,
  );
  assertEqual(after.snapshot.run.tick, FIRES_ON, "the tick the drive reached");
  assertEqual(
    after.arrivals.length,
    SWARM_SIZE,
    `the enemies the ${EVENT.time} s event spawned with aliveCommons at the cap of ${CAP}`,
  );
  for (const arrival of after.arrivals) {
    assertEqual(arrival.enemy.type, "gnat", "the type each arrival took");
  }
  assertEqual(
    after.snapshot.run.aliveCommons,
    CAP,
    "aliveCommons after the swarm, which gnats stand outside of",
  );
});
