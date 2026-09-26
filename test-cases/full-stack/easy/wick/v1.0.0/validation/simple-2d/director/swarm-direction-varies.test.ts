// director/swarm-direction-varies — a swarm's direction is drawn, so the
// swarms of several nights are not all lined up the same way.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Scripted events"): a swarm's gnats stand "along a
//     line perpendicular to a direction `d`, a unit vector at an angle drawn
//     uniformly over the full circle".
//
// WHAT IS READ. The 1:00 swarm of `SWARMS` (6) isolated nights. The direction
// of each is recovered from the line itself, whose centroid is
// `player + d * SPAWN_DISTANCE`, and the six must not all be one. A build that
// lines every swarm up along one fixed direction reports the same angle six
// times. Nothing is posed for the direction, so every draw is the build's own;
// a posed direction is `instrumentation/set-next-swarm-angle`.
//
// WHY THE NIGHT IS POSED AS IT IS. Each night is an isolated run with `events`
// alone on, entered from a `reset`, and carried across the same tick by the
// same operations, so the draw is the only thing that differs between them.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. `ANGLE_SEPARATION` (1e-6 degrees) separates two angles that were
// drawn from two that are the same figure: a build that fixes its direction
// repeats it exactly, and six independent uniform draws all land within a
// millionth of a degree of the first with probability nil.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { EVENTS, SWARM_SIZE } from "../constants";
import {
  angleAbout,
  angularOffset,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
  type Point,
} from "../harness";
import { closeIn, crossEvent, enemiesOfType, swarmDirection } from "./stage";

/** The 1:00 gnat swarm. */
const SWARM_TIME = EVENTS[0].time;

/** How many nights' swarms are read. */
const SWARMS = 6;

/** How far apart two angles must be, in degrees, to have been drawn apart. */
const ANGLE_SEPARATION = 1e-6;

const ORIGIN: Point = { x: 0, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The angle, in degrees, the 1:00 swarm of a fresh isolated night came from. */
async function swarmAngle(night: number): Promise<number> {
  isolate(h);
  enable(h, "events");
  const pair = await crossEvent(h, SWARM_TIME);
  const gnats = enemiesOfType(pair.on, "gnat");
  assertLength(gnats, SWARM_SIZE, `the swarm's gnats on night ${night}`);
  return angleAbout(ORIGIN, swarmDirection(gnats, pair.on.run.player));
}

it("draws a swarm's direction rather than fixing it", async () => {
  const angles: number[] = [];
  for (let night = 1; night <= SWARMS; night += 1) {
    angles.push(await swarmAngle(night));
  }
  await closeIn(h);
  captureStill(h, "random");

  const spread = angles.filter(
    (angle) => Math.abs(angularOffset(angles[0], angle)) > ANGLE_SEPARATION,
  );
  assertGreaterThan(
    spread.length,
    0,
    `swarm directions differing from the first, across ${SWARMS} nights`,
  );
});
