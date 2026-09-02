// director/swarm-direction-varies — a swarm arrives from a drawn direction.
//
// THE SPEC LINE. `specs/enemies.md`, "Scripted events": a swarm's line is
// perpendicular to "a direction `d`, a unit vector at an angle drawn uniformly
// from the seeded generator". "The spawn director" makes the generator the
// game's own — "Its randomness, the spawn angle and the type choice, is drawn
// from the game's seeded generator" — and
// `specs/instrumentation.md` ("A deterministic core") has that generator
// "seeded by `reset`", with `reset`'s `options.seed` naming the seed.
//
// WHAT IS READ, AND WHY IT IS TWO RUNS RATHER THAN TWO SWARMS. A run holds
// three swarms, but a build that draws once and reuses the draw all night
// would still be drawing; what the specification fixes is that the direction
// comes from the generator, so the reading that catches a fixed direction is
// two runs seeded differently. Each run is carried across tick 3600 and its
// swarm's `d` is recovered from where its gnats stand — the mean of the 24
// centers is the line's center exactly, the offsets summing to zero — and the
// two directions are compared as an angle.
//
// THE DRIVE. Two isolated worlds, one per seed, each with `events` alone on
// and the one tick that crosses tick 3600.
//
// THE TOLERANCE. `ANGLE_EPS`, a millionth of a degree, as the bound the two
// directions must differ by. A uniform draw lands two angles that close about
// never; a build with a fixed direction lands them exactly equal.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ANGLE_EPS, EVENTS, SWARM_SIZE } from "../constants";
import {
  angleOf,
  angularOffset,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick, swarmFrame } from "./spawns";

/** The 1:00 swarm, and the tick it fires on. */
const EVENT = EVENTS[0];
const FIRES_ON = eventTick(EVENT.time);

/** The two seeds compared; any two distinct values serve. */
const SEED_A = 1;
const SEED_B = 987_654;

/** The angle of the swarm's direction d, in degrees, for a run of `seed`. */
async function swarmAngle(h: Harness, seed: number): Promise<number> {
  isolate(h, { seed });
  h.debug.setTick(FIRES_ON - 1);
  enable(h, "events");
  const drive = await driveArrivals(h, 1);
  assertEqual(
    drive.arrivals.length,
    SWARM_SIZE,
    `the gnats the ${EVENT.time} s swarm of seed ${seed} spawned`,
  );
  const { direction } = swarmFrame(
    drive.arrivals[0].player,
    drive.arrivals.map((arrival) => arrival.enemy),
  );
  return angleOf(direction.x, direction.y);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lines up the swarms of two differently seeded runs along different directions", async () => {
  const fromA = await swarmAngle(h, SEED_A);
  const fromB = await swarmAngle(h, SEED_B);
  captureStill(h, "random");

  assertGreaterThan(
    Math.abs(angularOffset(fromA, fromB)),
    ANGLE_EPS,
    `the degrees between the swarm direction of seed ${SEED_A} and that of seed ${SEED_B}`,
  );
});
