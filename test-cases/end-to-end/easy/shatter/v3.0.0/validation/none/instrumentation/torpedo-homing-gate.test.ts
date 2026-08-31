// instrumentation/torpedo-homing-gate — `setTorpedoHoming(id, false)` really does
// shut one torpedo's guidance: it holds its heading past a rock squarely inside its
// forward cone. With the guidance running, the same pose turns it onto that rock.
// `warhead` only.
//
// WHY THIS OPERATION NEEDS AN ITEM. `torpedo/flies-true-through-the-well` poses a
// torpedo with its guidance off so that the only thing that could turn it is the
// well, and that item's domains are `gravity` and `arcade` — so a
// `setTorpedoHoming` that does nothing would lower the GRAVITY rating of a build
// whose well is perfectly correct. The fault belongs here, on the instrumentation
// it really is, and this is the item that names it.
//
// WHAT THE FACULTY COVERS. `specs/instrumentation.md` scopes it to "that torpedo's
// guidance alone: the forward-cone acquisition and the turn onto a target. Off, it
// holds its heading. Its travel, its lifetime, and its impacts run on." So both legs
// read the HEADING, and neither asks anything about how far the craft got.
//
// THE ROCK IS PUT SQUARELY INSIDE THE CONE, NOT ON ITS EDGE. `specs/weapons.md`
// makes a body a candidate when its bearing lies within `TORPEDO_CONE` (15 degrees)
// of the heading; the rock here sits at 8 degrees off, comfortably inside, so
// neither leg turns on where a build rounds the cone's edge — `torpedo/homing-cone-
// is-forward-only` is the item that decides the edge.
//
// AND THE SCENARIO IS FLOWN WHERE NOTHING ELSE CAN TURN IT. The torpedo runs up the
// left of the field, four hundred units clear of the star's core, and
// `specs/gravity.md` says the well never touches a torpedo in any case; the rock is
// four hundred units out too, where the pull moves it under two units over the
// span. The reading is taken well before either leg's torpedo could reach the rock,
// so what is compared is a heading rather than an impact.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { DEG, ROCK_RADIUS, TORPEDO_SPEED } from "../constants";
import { angleBetween, bearingTo, wrappedDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  HANDLE,
  poseRock,
  poseTorpedo,
  requireRock,
  requireTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The operations this check drives, all of them stated under `warhead`. */
const OPS = ["addTorpedo", "setTorpedoHoming"] as const;

/** Where the torpedo is launched: up the left of the field, clear of the core. */
const LAUNCH = { x: 200, y: 620 } as const;

/** The heading it is launched on: straight up the field, in radians. */
const HEADING = -90 * DEG;

/** How far off that heading the rock is placed, in degrees: well inside the cone. */
const OFFSET_DEG = 8;

/** How far ahead the rock is placed, in logical units. */
const RANGE = 260;

/**
 * The game time each leg runs for, in seconds.
 *
 * Long enough that a running guidance has turned and settled — `specs/weapons.md`
 * gives it `TORPEDO_TURN` (160 degrees per second), so the eight degrees here take
 * a twentieth of a second — and short enough that neither leg's torpedo has covered
 * the range to the rock: at `TORPEDO_SPEED` it crosses 147 of the 260 units.
 */
const SPAN = 0.35;

/**
 * How far a held heading may sit from the one it was launched on, in radians.
 *
 * Half a degree. `specs/instrumentation.md` says a torpedo with its guidance off
 * "holds its heading", and `specs/gravity.md` says the well never touches it, so a
 * conforming build reports the heading it was given. A single tick of the turn rate
 * `specs/weapons.md` fixes is 1.33 degrees, so anything that turned at all is
 * outside this.
 */
const HOLD_TOLERANCE = 0.5 * DEG;

/**
 * How far a turned heading may sit from the bearing to its target, in radians.
 *
 * Three degrees. The guidance re-evaluates every tick and turns at up to 1.33
 * degrees per tick, so a torpedo tracking a target sits within a tick or two of
 * the bearing rather than exactly on it, and the rock drifts about two units under
 * the well over the span, which is under a degree at this range.
 */
const AIM_TOLERANCE = 3 * DEG;

/**
 * The least a running guidance must have turned the heading, in radians.
 *
 * Four degrees: half the offset the rock is placed at, so a build that acquired the
 * rock and turned toward it at any usable rate clears it, and a build that turned
 * nothing at all cannot.
 */
const LEAST_TURN = 4 * DEG;

let h: Harness;

/**
 * Fail with what the specification requires named, rather than crashing the script
 * on a call into something that is not a function.
 *
 * The torpedo operations are a `warhead` deliverable, so a build that carries none
 * of them owes them; every leg below reflects the surface before it drives it.
 */
async function requireTorpedoOps(): Promise<void> {
  const probed = await h.probe(OPS);
  for (const op of OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }
}

/** Put the rock `RANGE` ahead of the launch point, `OFFSET_DEG` off the heading. */
async function poseTarget(): Promise<number> {
  const bearing = HEADING + OFFSET_DEG * DEG;
  return poseRock(
    h,
    "medium",
    LAUNCH.x + Math.cos(bearing) * RANGE,
    LAUNCH.y + Math.sin(bearing) * RANGE,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the torpedo's heading while its guidance is shut", async () => {
  await requireTorpedoOps();

  await startPlaying(h);
  const rockId = await poseTarget();
  const torpedoId = await poseTorpedo(h, LAUNCH.x, LAUNCH.y, HEADING, {
    homing: false,
  });

  await h.advance(ticksFor(SPAN));
  await captureStill(h, "held");
  const flown = await h.snapshot();
  const torpedo = requireTorpedo(
    flown,
    torpedoId,
    "the torpedo with its guidance shut",
  );
  const rock = requireRock(flown, rockId, "the rock inside the cone");

  // The rock really was ahead of it and still out of reach, so what is read is a
  // heading held past an acquirable target rather than one read after an impact.
  assertGreaterThan(
    wrappedDistance(torpedo, rock),
    ROCK_RADIUS.medium,
    "the rock was still ahead of the torpedo at the reading",
  );
  assertLessThanOrEqual(
    angleBetween(torpedo.heading, HEADING),
    HOLD_TOLERANCE,
    "the heading a torpedo with setTorpedoHoming(id, false) held",
  );
});

it("turns the torpedo onto the same rock once its guidance is running", async () => {
  await requireTorpedoOps();

  await startPlaying(h);
  const rockId = await poseTarget();
  const torpedoId = await poseTorpedo(h, LAUNCH.x, LAUNCH.y, HEADING, {
    homing: true,
  });

  await h.advance(ticksFor(SPAN));
  const flown = await h.snapshot();
  const torpedo = requireTorpedo(
    flown,
    torpedoId,
    "the torpedo with its guidance running",
  );
  const rock = requireRock(flown, rockId, "the rock inside the cone");

  assertGreaterThan(
    angleBetween(torpedo.heading, HEADING),
    LEAST_TURN,
    "the heading a torpedo with setTorpedoHoming(id, true) turned through",
  );
  assertLessThanOrEqual(
    angleBetween(torpedo.heading, bearingTo(torpedo, rock)),
    AIM_TOLERANCE,
    "how far the turned heading sits from the bearing to the rock it took",
  );
  // And it is still flying rather than spent: the speed `specs/weapons.md` holds
  // constant, whether or not it is turning.
  assertGreaterThan(
    Math.hypot(torpedo.vx, torpedo.vy),
    TORPEDO_SPEED / 2,
    "the torpedo was still under way at the reading",
  );
});
