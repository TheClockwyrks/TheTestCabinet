// director/events-spawn-past-cap — a scripted event spawns with the cap full.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The cap"): "The cap
// governs the timer's spawns alone; a scripted event spawns regardless of it",
// and, of the gnats, the elites and the Dark, "they spawn whether or not it is
// full". The event read is `EVENTS`' first row, "| 1:00 | 60 | Gnat swarm |",
// which fires on tick `60 × TICK_HZ`, 3600, and spawns "`SWARM_SIZE` (`24`)
// gnats on the same tick".
//
// WHICH CAP IS FULL. The cap is the current window's ("`interval` and `cap` are
// the current window's"), and the window on tick 3600 is
// `min(19, floor(3600 / 60 / 30))`, 2, whose row reads
// "| 2 | 1:00 | moth, bat, rat | 0.60 | 40 |" — a cap of 40. So forty commons
// are posed, which is the cap this tick would be held against, and the swarm
// must arrive whole anyway. Posing fewer would leave the point deciding
// nothing, because a director that respected the cap would have had room.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone, so
// the window timer cannot add spawns of its own to the tick and the count read
// is the event's. The forty moths stand well outside the spawn ring and
// `enemyMotion`, `enemyContact` and `despawning` are off, so the count is
// exactly forty for the whole crossing. The tick before the event is run first,
// as `director/events.ts` states, so a build that fires early is separated from
// one that fires on the tick.
//
// THE TOLERANCE. Whole counts and a type name, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPAWN_WINDOWS, SWARM_SIZE, spawnWindowIndex } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { carryAcross, isolateForEvents } from "./events";
import { SWARM_SECONDS, SWARM_TICK } from "./swarms";

/** The window the swarm's tick falls in. */
const WINDOW = spawnWindowIndex(SWARM_SECONDS);

/** That window's cap: the count posed alive. */
const CAP = SPAWN_WINDOWS[WINDOW]!.cap;

/** Where the posed commons stand: well outside the spawn ring. */
const FILLER_X = 2000;

/** The gap between them, so no two share a point. */
const FILLER_GAP = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns the swarm's 24 gnats on tick 3600 with the window's cap full", async () => {
  await isolateForEvents(h);
  for (let at = 0; at < CAP; at += 1) {
    await h.debug.spawnEnemy("moth", FILLER_X + at * FILLER_GAP, 0);
  }

  const crossing = await carryAcross(h, SWARM_TICK);
  await captureStill(h, "past");

  assertEqual(
    crossing.edge.run.aliveCommons,
    CAP,
    `aliveCommons on the tick before the event, against window ${WINDOW}'s cap of ${CAP}`,
  );
  assertEqual(
    crossing.early.length,
    0,
    "enemies the tick before the event spawned",
  );
  assertEqual(
    crossing.arrivals.length,
    SWARM_SIZE,
    `gnats the event spawned on tick ${SWARM_TICK} with the cap full`,
  );
  for (const arrival of crossing.arrivals) {
    assertEqual(arrival.type, "gnat", "the type the event spawned");
  }
});
