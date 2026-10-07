// director/event-fires-once-per-run — an event fires once in a run, and again
// in the next.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events"): "Each
// fires once per run, on exactly the tick the run clock equals its time", and
// "`firedEvents` lists the times that have fired, in ascending order whatever
// order they fired in". Once PER RUN is two claims, and both are read here: the
// same tick reached a second time in one run spawns nothing and leaves the list
// holding the time once, and a fresh run — "A reset leaves the game
// indistinguishable from a freshly started session"
// (specs/instrumentation.md) — fires it again.
//
// WHY THE CLOCK MAY BE PUT BACK. `setTick(tick)` "Sets `tick` to `tick` ...
// Nothing else changes: `spawnTimer`, `firedEvents`, and every live entity stay
// as they stand", with no direction on it, so posing the clock back to 3599 and
// stepping across 3600 again is the same crossing the first one was, run
// against a run that has already fired it. A build that keyed the event off the
// clock alone rather than off what has fired spawns a second swarm and fails.
//
// WHY THE FIELD IS CLEARED BETWEEN THE TWO. So the second crossing's reading is
// a count of what THAT tick spawned rather than of what is standing about;
// `clearEnemies` "Removes every enemy ... the same way" and changes nothing
// else the point reads.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone, so
// the window timer puts no spawns of its own on these ticks, and nothing moves
// or is removed between the readings.
//
// THE TOLERANCE. Whole counts and a list of whole seconds, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { SWARM_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  newEnemies,
  type Harness,
} from "../harness";
import { carryAcross, isolateForEvents } from "./events";
import { SWARM_SECONDS, SWARM_TICK } from "./swarms";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires the 1:00 swarm once in a run and again in a fresh one", async () => {
  await isolateForEvents(h);
  const first = await carryAcross(h, SWARM_TICK);
  assertEqual(
    first.arrivals.length,
    SWARM_SIZE,
    `gnats the first crossing of tick ${SWARM_TICK} spawned`,
  );

  await h.debug.clearEnemies();
  await h.debug.setTick(SWARM_TICK - 1);
  const before = await h.snapshot();
  const again = await h.step(1);
  await captureStill(h, "once");

  assertEqual(
    again.run.tick,
    SWARM_TICK,
    "the tick the second crossing reached",
  );
  assertEqual(
    newEnemies(before, again).length,
    0,
    `enemies the second crossing of tick ${SWARM_TICK} spawned`,
  );
  assertDeepEqual(
    again.run.firedEvents,
    [SWARM_SECONDS],
    "firedEvents after the same event's tick has been crossed twice",
  );

  await isolateForEvents(h);
  const fresh = await carryAcross(h, SWARM_TICK);

  assertEqual(
    fresh.arrivals.length,
    SWARM_SIZE,
    `gnats a fresh run's crossing of tick ${SWARM_TICK} spawned`,
  );
  assertDeepEqual(
    fresh.fired.run.firedEvents,
    [SWARM_SECONDS],
    "firedEvents in the fresh run",
  );
});
