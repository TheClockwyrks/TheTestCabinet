// director/swarm-heading — every gnat of a swarm flies the way the line came.
//
// THE SPEC LINE. `specs/enemies.md`, "Scripted events": "Every gnat in the
// swarm spawns with heading `-d`, so the whole line drifts across the
// lamplighter's position and on past it." `d` is the direction the line's
// center sits along from the lamplighter, so `-d` points back at the
// lamplighter and the line sweeps through. A gnat's behavior is `drift`, and
// "A drifting enemy keeps the heading it spawned with for its whole life",
// which is what makes the swarm a wall rather than a cloud that converges.
//
// HOW `d` IS RECOVERED, SINCE IT IS RANDOM. From where the gnats stand. The
// offsets of the swarm's formula sum to zero, so the mean of the 24 centers is
// the line's center exactly, and `d` is the unit vector from the lamplighter
// to it. The heading each gnat reports is then compared against `-d`
// component by component.
//
// WHY THE HEADING IS READ ON THE SPAWN TICK. `specs/enemies.md` ("The life of
// an enemy") gives a spawn "the heading its behavior gives it", and
// `specs/world.md` ("One tick") has it sit at its spawn point that tick, so
// the tick that crosses tick 3600 is where both the line and its heading are
// legible together. The frames after it, with `enemyMotion` on, are the
// drift the replay shows; they change no reading, since a drifter keeps its
// heading.
//
// THE TOLERANCE. `MOTION_EPS` on each component of a unit vector, which is
// a millionth against components of at most 1 — far tighter, in relative
// terms, than any other reading in this category, and still far above the
// rounding of recovering `d` through a mean and a hypotenuse.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertPointNear } from "../assert";
import { EVENTS, MOTION_EPS, SWARM_SIZE, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick, swarmFrame } from "./spawns";

/** The 1:00 swarm, and the tick it fires on. */
const EVENT = EVENTS[0];
const FIRES_ON = eventTick(EVENT.time);

/** Frames of drift the replay shows, once the reading has been taken. */
const DRIFT_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives every gnat of the swarm the heading -d", async () => {
  isolate(h);
  h.debug.setTick(FIRES_ON - 1);
  enable(h, "events");

  const drive = await captureReplay(h, "heading", async () => {
    const spawned = await driveArrivals(h, 1);
    enable(h, "enemyMotion");
    await h.advance(DRIFT_TICKS);
    return spawned;
  });

  assertEqual(
    drive.arrivals.length,
    SWARM_SIZE,
    `the gnats the ${EVENT.time} s swarm spawned`,
  );
  const player = drive.arrivals[0].player;
  const gnats = drive.arrivals.map((arrival) => arrival.enemy);
  const { direction } = swarmFrame(player, gnats);
  const back = { x: -direction.x, y: -direction.y };

  for (const gnat of gnats) {
    assertPointNear(
      gnat.heading,
      back,
      MOTION_EPS,
      `gnat ${gnat.id}: the heading it spawned with`,
    );
  }
});
