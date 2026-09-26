// director/swarm-direction-varies — a swarm arrives from a drawn direction.
//
// THE SPEC LINE. `specs/enemies.md`, "Scripted events": a swarm's line is
// perpendicular to "a direction `d`, a unit vector at an angle drawn uniformly
// over the full circle".
//
// WHAT IS READ, AND WHY IT IS SEVERAL NIGHTS RATHER THAN SEVERAL SWARMS. A
// run holds three swarms, but a build that draws once and reuses the draw all
// night would still be drawing; what the specification fixes is that the
// direction is drawn, so the reading that catches a fixed direction is the
// 1:00 swarm of `NIGHTS` (6) isolated nights, which must not all line up the
// same way. Each night is carried across tick 3600 and its swarm's `d` is
// recovered from where its gnats stand — the mean of the 24 centers is the
// line's center exactly, the offsets summing to zero — and the directions are
// compared as angles. Nothing is posed for the direction, so every draw is
// the build's own; a posed direction is
// `instrumentation/set-next-swarm-angle`'s.
//
// THE DRIVE. Six isolated worlds, each with `events` alone on and the one
// tick that crosses tick 3600.
//
// THE TOLERANCE. `ANGLE_EPS`, a millionth of a degree, as the bound two
// directions must differ by. Six uniform draws all landing that close to the
// first happens about never; a build with a fixed direction lands them
// exactly equal.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
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

/** How many nights' swarms are read. */
const NIGHTS = 6;

/** The angle of the swarm's direction d, in degrees, on a fresh night. */
async function swarmAngle(h: Harness, night: number): Promise<number> {
  isolate(h);
  h.debug.setTick(FIRES_ON - 1);
  enable(h, "events");
  const drive = await driveArrivals(h, 1);
  assertEqual(
    drive.arrivals.length,
    SWARM_SIZE,
    `the gnats the ${EVENT.time} s swarm of night ${night} spawned`,
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

it("lines up the swarms of several nights along more than one direction", async () => {
  const angles: number[] = [];
  for (let night = 1; night <= NIGHTS; night += 1) {
    angles.push(await swarmAngle(h, night));
  }
  captureStill(h, "random");

  const spread = angles.filter(
    (angle) => Math.abs(angularOffset(angles[0], angle)) > ANGLE_EPS,
  ).length;
  assertGreaterThanOrEqual(
    spread,
    1,
    `the swarms arriving from a direction other than the first's ${angles[0]}, across ${NIGHTS} nights`,
  );
});
