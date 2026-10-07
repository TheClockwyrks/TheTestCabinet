// director/events-spawn-past-cap — a scripted event spawns whether or not the
// cap is full.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The cap"): "The cap governs the timer's spawns
//     alone; a scripted event spawns regardless of it", and "Gnats, the elites,
//     and the Dark stand outside the cap: they are never counted against it,
//     and they spawn whether or not it is full."
//   - `specs/enemies.md` ("Scripted events"): the 1:00 event is a gnat swarm,
//     which "spawns `SWARM_SIZE` (`24`) gnats on the same tick", firing "on
//     exactly the tick the run clock equals its time (`tick == time *
//     TICK_HZ`)", tick 3600.
//   - `specs/enemies.md` ("Windows"): tick 3600 is 60 seconds, which
//     `min(19, floor(time / SPAWN_WINDOW))` puts in window 2, whose cap is 40.
//
// WHAT IS READ. The window's own cap is posed full, forty commons, with the
// spawn timer resting due and `spawning` on, so the timer is refusing a spawn
// on every tick of the stretch. The clock is then carried across tick 3600 with
// `events` on: the swarm's 24 gnats must land on that tick, and no common may
// be added beside them. A build that gated its events on the cap spawns
// nothing.
//
// WHY THE NIGHT IS POSED AS IT IS. The cap is filled with the cap of the window
// the event falls in, not of window 0, because a crowd short of the current
// window's cap would leave the timer free to spawn and the reading would say
// nothing about the cap. `enemyMotion`, `despawning`, and `enemyContact` are
// off, so the crowd neither leaves nor changes across the two ticks.
//
// TOLERANCE. None: counts of enemies on one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  EVENTS,
  SPAWN_WINDOWS,
  spawnWindowAt,
  SWARM_SIZE,
  TICK_HZ,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { crossEvent, enemiesOfType, poseRing } from "./stage";

/** The 1:00 gnat swarm, the night's first scripted event. */
const SWARM_TIME = EVENTS[0].time;

/** The cap in force where the event falls: window 2's, 40 commons. */
const CAP = SPAWN_WINDOWS[spawnWindowAt(SWARM_TIME)].cap;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns the swarm over a full cap", async () => {
  isolate(h);
  enable(h, "spawning", "events");
  poseRing(h, "moth", CAP);
  h.debug.setSpawnTimer(0);

  const pair = await crossEvent(h, SWARM_TIME);
  captureStill(h, "past");

  assertEqual(
    pair.before.run.tick,
    SWARM_TIME * TICK_HZ - 1,
    "the tick before",
  );
  assertLength(
    pair.before.run.enemies,
    CAP,
    "enemies on the tick before the event, the cap refusing the timer",
  );
  assertLength(
    enemiesOfType(pair.on, "gnat"),
    SWARM_SIZE,
    "the swarm's gnats on the event's tick",
  );
  assertEqual(
    pair.on.run.aliveCommons,
    CAP,
    "the commons counted against the cap after the swarm",
  );
});
