// gravity/rock-curves — the well bends a drifting rock.
//
// `specs/gravity.md` lists "a rock, of any size" among the pulled bodies, and
// `specs/rocks.md` gives a rock nothing of its own that could turn it: it drifts
// at a constant base speed and wraps, and its spin is drawn rather than
// simulated. So the only thing in the specification that can change the DIRECTION
// a rock travels in is the well, and this item reads exactly that — the bearing
// of its velocity, a second of game time after it was set drifting past the star.
//
// WHY THE VELOCITY'S BEARING AND NOT THE PATH. A rock is a slow, heavy body and
// the well works on it gently; over a second the path bows by a few units, which
// is a small reading beside the rock's own 110 units of travel. The TURN is the
// clean one — the specification says the acceleration is toward the star's
// centre, so the velocity swings toward it, and eleven and a half degrees of
// swing is a figure a build either produces or does not.
//
// THE DRIFT, AND WHY IT IS THIS ONE. A Medium rock at 110 units per second, which
// `specs/rocks.md` puts squarely inside the 90-to-150 band its size drifts at, so
// the pose is a drift the game itself produces rather than a contrivance. It is
// set going along the line 150 units above the star's row, from far enough left
// that the second of drift passes the star's column: the well is behind it for
// the first half of that second and ahead of it for the second, so a build that
// applies the pull with the wrong sign turns the other way rather than merely
// turning less. Its closest approach over the second is about 216 units against a
// `CORE_R + ROCK_RADIUS.medium` of 56, so `specs/collision.md`'s recycling of a
// rock at the core never fires and the rock is still there to be read.
//
// WHAT THE TURN IS COMPARED AGAINST. The law is fully determined — `MU / d^2`
// toward the star's centre, integrated as `specs/simulation.md` orders a tick —
// so the turn it produces over this drift is computable, and it is computed here
// from `specs/gravity.md`'s own figures through `geometry.ts` rather than looked
// up from any build. The three orders a build could plausibly integrate in (the
// specification's, the accelerations read after the move, and the position
// advanced on the old velocity) give 11.455, 11.436 and 11.539 degrees, a spread
// of under one percent, so the band below is wide enough that HOW a build divides
// the second cannot decide the item while a well of the wrong strength or the
// wrong sign still can.
//
// Nothing else on the field: `startPlaying` empties it and shuts the wave loop,
// so the second this runs for cannot be joined by a wave, and `specs/collision.md`
// has two rocks pass through each other in any case.
//
// AND THE CLIP DOES NOT CUT ON THE MEASUREMENT. The verdict is read at one
// second, and the recording runs half a second further so the reviewer sees the
// rock carry on round the star rather than the frame the turn was read on.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  STAR_Y,
  TICK_DT,
} from "../../src/constants";
import { assertBetween, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { STAR, angleBetween, gravityAt, wrap } from "../geometry";
import {
  add,
  bearingOf,
  componentAcross,
  scale,
  subtract,
  velocityOf,
  type Point,
} from "./law";

/** How far from the star's centre the rock's line passes. */
const MISS_DISTANCE = 150;

/** Where the rock starts: on that line, left of the star's column. */
const START: Point = { x: 340, y: STAR_Y - MISS_DISTANCE };

/**
 * The rock's drift: along the line at 110 units per second.
 *
 * Inside the 90-to-150 band `specs/rocks.md` gives a Medium's base drift speed,
 * asserted below so a change to either figure cannot leave this pose outside it.
 */
const DRIFT: Point = { x: 110, y: 0 };

/** The seconds of game time the drift is followed for: the review item's figure. */
const DRIFT_SECONDS = 1;

/** Those seconds, in whole ticks. */
const DRIFT_TICKS = ticksFor(DRIFT_SECONDS);

/** The ticks of drift the replay keeps after the reading, so it does not cut on it. */
const AFTERMATH_TICKS = ticksFor(0.5);

/**
 * How far the turn may fall from the one the law itself produces: fifteen percent.
 *
 * Wide enough to swallow the under-one-percent spread between the integration
 * orders a build could reasonably use, and every rounding difference beneath
 * that. Narrow enough that a rock the well never touched (no turn at all), a rock
 * turned away from the star (the turn negated), or a well off the stated strength
 * by more than a sixth all fall outside it.
 */
const TURN_TOLERANCE = 0.15;

/** Which way across the drift the star lies, as a sign: which way is "toward". */
const TOWARD_STAR = Math.sign(componentAcross(subtract(STAR, START), DRIFT));

/**
 * The turn the stated law gives this drift, in radians, signed.
 *
 * Integrated straight out of `geometry.ts`'s reading of `specs/gravity.md` and
 * `specs/simulation.md`'s tick order — the gravity acceleration taken at the
 * position the tick opened on, added to the velocity over `TICK_DT`, then the
 * position advanced on the new velocity and wrapped. Nothing here reads a build.
 */
function predictedTurn(): number {
  let at = START;
  let velocity = DRIFT;
  for (let tick = 0; tick < DRIFT_TICKS; tick += 1) {
    const { ax, ay } = gravityAt(at);
    velocity = add(velocity, scale({ x: ax, y: ay }, TICK_DT));
    at = wrap(add(at, scale(velocity, TICK_DT)));
  }
  return angleBetween(bearingOf(DRIFT), bearingOf(velocity));
}

const EXPECTED_TURN = predictedTurn();

/** The ends of the band the measured turn must fall in. */
const TURN_LOW = Math.min(
  EXPECTED_TURN * (1 - TURN_TOLERANCE),
  EXPECTED_TURN * (1 + TURN_TOLERANCE),
);
const TURN_HIGH = Math.max(
  EXPECTED_TURN * (1 - TURN_TOLERANCE),
  EXPECTED_TURN * (1 + TURN_TOLERANCE),
);

// A self-check on the POSE, not on any build, run at import so that a figure this
// item rests on going stale is a broken suite rather than a verdict reached in
// the dark. `specs/rocks.md` bands a Medium's base drift speed, and this item's
// reading is only worth what it is worth if the drift is one the game produces.
if (DRIFT.x < ROCK_SPEED_MIN.medium || DRIFT.x > ROCK_SPEED_MAX.medium) {
  throw new Error(
    `gravity/rock-curves: the posed drift of ${DRIFT.x} is outside a Medium's ` +
      `band of ${ROCK_SPEED_MIN.medium} to ${ROCK_SPEED_MAX.medium} ` +
      `(specs/rocks.md)`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns a drifting rock's velocity toward the star over a second", async () => {
  startPlaying(h);
  const id = poseRock(h, "medium", START.x, START.y, DRIFT.x, DRIFT.y);

  const snapshot = await captureReplay(h, "curve", async () => {
    await h.advance(DRIFT_TICKS);
    const reading = h.snapshot();
    await h.advance(AFTERMATH_TICKS);
    return reading;
  });

  const rock = rockById(
    snapshot,
    id,
    `a rock ${DRIFT_SECONDS} second into a ${MISS_DISTANCE}-unit pass of the star`,
  );
  const turn = angleBetween(bearingOf(DRIFT), bearingOf(velocityOf(rock)));

  assertGreaterThan(
    turn * TOWARD_STAR,
    0,
    "radians the rock's velocity turned toward the star, signed toward it " +
      "(specs/gravity.md: a rock of any size is pulled)",
  );
  assertBetween(
    turn,
    TURN_LOW,
    TURN_HIGH,
    `radians the rock's velocity turned over ${DRIFT_SECONDS} second, against ` +
      `the law's own ${EXPECTED_TURN}`,
  );
});
