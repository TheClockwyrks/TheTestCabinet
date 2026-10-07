// director/event-fires-once-per-run — a scripted event fires once in a run, and
// again in the next run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Scripted events"): "`EVENTS` lists the night's
//     scripted spawns in time order. Each fires once per run, on exactly the
//     tick the run clock equals its time", and "`firedEvents` lists the times
//     that have fired, in ascending order whatever order they fired in."
//   - `specs/instrumentation.md` (`setTick`): "Sets `tick` to `tick` ...
//     `spawnTimer`, `firedEvents`, and every live entity stay as they stand",
//     so posing the clock back before an event does not un-fire it.
//   - `specs/instrumentation.md` (`setScreen`): `playing` from another screen
//     "Begins a fresh run", and `reset` "Restores every declared field of the
//     game's state to its title-screen value".
//
// WHAT IS READ. The 1:00 swarm is fired, the field emptied, and the clock posed
// back before tick 3600 and carried across it again: no second swarm may land,
// and `firedEvents` must still hold 60 exactly once. Then a fresh run is opened
// and the same crossing must fire the swarm again, which is what makes it once
// per RUN rather than once per game.
//
// WHY THE NIGHT IS POSED AS IT IS. `events` alone is on, so the field's
// contents on each reading came from the event alone; the field is emptied
// between the two crossings, so the second is read against an empty field and a
// swarm that landed could not be missed.
//
// TOLERANCE. None: counts of enemies, and the times `firedEvents` lists.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { EVENTS, SWARM_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { crossEvent, enemiesOfType } from "./stage";

/** The 1:00 gnat swarm. */
const SWARM_TIME = EVENTS[0].time;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires an event once in a run and again in the next", async () => {
  isolate(h);
  enable(h, "events");

  const first = await crossEvent(h, SWARM_TIME);
  assertLength(
    enemiesOfType(first.on, "gnat"),
    SWARM_SIZE,
    "the swarm's gnats the first time the tick was crossed",
  );

  h.debug.clearEnemies();
  const again = await crossEvent(h, SWARM_TIME);
  captureStill(h, "once");

  assertLength(
    again.on.run.enemies,
    0,
    "enemies after crossing the event's tick a second time",
  );
  assertDeepEqual(
    again.on.run.firedEvents,
    [SWARM_TIME],
    "firedEvents after the second crossing",
  );

  isolate(h);
  enable(h, "events");
  const fresh = await crossEvent(h, SWARM_TIME);

  assertLength(
    enemiesOfType(fresh.on, "gnat"),
    SWARM_SIZE,
    "the swarm's gnats in a fresh run",
  );
  assertDeepEqual(
    fresh.on.run.firedEvents,
    [SWARM_TIME],
    "firedEvents in a fresh run",
  );
});
