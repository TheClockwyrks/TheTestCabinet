// director/event-fires-once-per-run — an event is spent once it has fired.
//
// THE SPEC LINE. `specs/enemies.md`, "Scripted events": "`EVENTS` lists the
// night's scripted spawns in time order. Each fires once per run, on exactly
// the tick the run clock equals its time ... `firedEvents` lists the times
// that have fired". Once per RUN, so a new run fires it again:
// `specs/instrumentation.md` (`setScreen`) makes `playing` from the title
// "Begin a fresh run", and `specs/state.md` gives a fresh run an empty
// `firedEvents`.
//
// WHAT THE CLOCK CAN AND CANNOT DO. `setTick` "Sets `tick` to `tick`. Nothing
// else changes: `spawnTimer`, `firedEvents`, and every live entity stay as
// they stand", so posing the clock back to 3599 leaves the fired 60 in the
// list, and the second crossing of tick 3600 meets an event that has already
// fired. A build that keys its events off the clock alone, rather than off
// what has fired, spawns a second swarm here.
//
// THE THREE READINGS. The swarm arrives the first time; nothing arrives the
// second time and 60 stands in `firedEvents` exactly once; and a fresh run
// over the same clock fires it again, which is what makes the rule "once per
// run" rather than "once ever".
//
// THE DRIVE. The isolated world with `events` alone on. The field is cleared
// between the crossings with `clearEnemies`, which "Removes every enemy,
// elites and the Dark included", so the second crossing is read against an
// empty field and an arrival cannot be missed among the first swarm's gnats.
//
// THE TOLERANCE. None: counts of arrivals and of entries in a list.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { EVENTS, SWARM_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick } from "./spawns";

/** The 1:00 swarm, and the tick it fires on. */
const EVENT = EVENTS[0];
const FIRES_ON = eventTick(EVENT.time);

/** Pose the clock one tick short of the event and cross it. */
async function cross(h: Harness): Promise<number> {
  h.debug.setTick(FIRES_ON - 1);
  const drive = await driveArrivals(h, 1);
  return drive.arrivals.length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the 1:00 swarm once however often the clock crosses its tick, and again in a fresh run", async () => {
  isolate(h);
  enable(h, "events");
  const first = await cross(h);

  h.debug.clearEnemies();
  const second = await cross(h);
  const fired = h.snapshot().run.firedEvents;

  isolate(h);
  enable(h, "events");
  const afresh = await cross(h);
  captureStill(h, "once");

  assertEqual(
    first,
    SWARM_SIZE,
    `the gnats the ${EVENT.time} s event spawned the first time the clock crossed tick ${FIRES_ON}`,
  );
  assertEqual(
    second,
    0,
    `the enemies that arrived the second time the clock crossed tick ${FIRES_ON} in the same run`,
  );
  assertLength(
    fired.filter((time) => time === EVENT.time),
    1,
    `the entries reading ${EVENT.time} in firedEvents after two crossings`,
  );
  assertEqual(
    afresh,
    SWARM_SIZE,
    `the gnats the ${EVENT.time} s event spawned in a fresh run`,
  );
});
