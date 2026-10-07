// director/swarm-heading — every gnat of a swarm heads back along `-d`, so the
// line drifts across the lamplighter.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Scripted events"): "Every gnat in the swarm spawns
//     with heading `-d`, so the whole line drifts across the lamplighter's
//     position and on past it", with `d` the direction the line is centered
//     along: "center = player + d * SPAWN_DISTANCE".
//   - `specs/enemies.md` ("Drift"): "A drifting enemy keeps the heading it
//     spawned with for its whole life and advances one step along it every
//     tick", and the Gnat's behavior is `drift`.
//   - `specs/instrumentation.md` ("Snapshot shape"): an enemy reports
//     `heading: { x, y }`.
//
// WHAT IS READ. The 1:00 swarm on the tick it lands. `d` is recovered from the
// line itself, whose centroid is `player + d * SPAWN_DISTANCE`, and every one
// of the 24 gnats must report that vector negated as its heading. A build that
// pointed each gnat at the lamplighter individually, rather than along one
// shared `-d`, reports 24 different headings and fails on the gnats at the ends
// of the line.
//
// WHY THE NIGHT IS POSED AS IT IS. `events` alone is on for the reading, so the
// gnats are read where and as the event created them. `enemyMotion` is turned
// on only afterwards, for the recording of the line drifting across, and after
// every assertion's reading has been taken.
//
// TOLERANCE. `DIRECTION_TOLERANCE` (1e-9) on each component: a heading is a
// unit vector the build normalized, compared against one recovered from the
// line's own geometry.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import { DIRECTION_TOLERANCE, EVENTS, SWARM_SIZE } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn, crossEvent, enemiesOfType, swarmDirection } from "./stage";

/** The 1:00 gnat swarm. */
const SWARM_TIME = EVENTS[0].time;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives every swarm gnat the heading -d", async () => {
  isolate(h);
  enable(h, "events");

  const read = await captureReplay(h, "heading", async () => {
    const crossed = await crossEvent(h, SWARM_TIME);
    const spawned = enemiesOfType(crossed.on, "gnat");
    await closeIn(h);
    return { player: crossed.on.run.player, gnats: spawned };
  });

  assertLength(read.gnats, SWARM_SIZE, "the swarm's gnats");

  const d = swarmDirection(read.gnats, read.player);
  for (const gnat of read.gnats) {
    assertWithin(
      gnat.heading.x,
      -d.x,
      DIRECTION_TOLERANCE,
      `the x of gnat ${gnat.id}'s heading`,
    );
    assertWithin(
      gnat.heading.y,
      -d.y,
      DIRECTION_TOLERANCE,
      `the y of gnat ${gnat.id}'s heading`,
    );
  }
});
