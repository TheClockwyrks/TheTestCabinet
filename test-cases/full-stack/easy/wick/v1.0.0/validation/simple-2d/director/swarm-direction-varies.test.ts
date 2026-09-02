// director/swarm-direction-varies — a swarm's direction is drawn from the
// seeded generator, so two seeds line their swarms up differently.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Scripted events"): a swarm's gnats stand "along a
//     line perpendicular to a direction `d`, a unit vector at an angle drawn
//     uniformly from the seeded generator".
//   - `specs/instrumentation.md` ("A deterministic core"): "The game holds one
//     pseudo-random generator, seeded by `reset` ... every random draw comes
//     from it: ... a swarm's direction"; `reset`: "`options.seed` seeds the
//     generator".
//
// WHAT IS READ. The 1:00 swarm from two runs laid with two different seeds. The
// direction of each is recovered from the line itself, whose centroid is
// `player + d * SPAWN_DISTANCE`, and the two must differ. A build that lines
// every swarm up along one fixed direction reports the same angle twice.
//
// WHY THE NIGHT IS POSED AS IT IS. Each run is an isolated night with `events`
// alone on, entered from a `reset` that lays the generator, so the only
// difference between the two readings is the seed.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. `ANGLE_SEPARATION` (1e-6 degrees) separates two angles that were
// drawn from two that are the same figure: a build that fixes its direction
// repeats it exactly, and two independent uniform draws land within a millionth
// of a degree of each other about five times in a thousand million.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { DEFAULT_SEED, EVENTS, SWARM_SIZE } from "../constants";
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

/** The second seed: far from `DEFAULT_SEED` (1), and a whole number in range. */
const OTHER_SEED = 987654321;

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

/** The angle, in degrees, the 1:00 swarm of a run laid with `seed` came from. */
async function swarmAngle(seed: number): Promise<number> {
  isolate(h, { seed });
  enable(h, "events");
  const pair = await crossEvent(h, SWARM_TIME);
  const gnats = enemiesOfType(pair.on, "gnat");
  assertLength(gnats, SWARM_SIZE, `the swarm's gnats under seed ${seed}`);
  return angleAbout(ORIGIN, swarmDirection(gnats, pair.on.run.player));
}

it("draws a swarm's direction from the seed", async () => {
  const first = await swarmAngle(DEFAULT_SEED);
  const second = await swarmAngle(OTHER_SEED);
  await closeIn(h);
  captureStill(h, "random");

  assertGreaterThan(
    Math.abs(angularOffset(first, second)),
    ANGLE_SEPARATION,
    "degrees between the directions two seeds drew",
  );
});
