// spin/preserved-obstacle — spin survives an obstacle bounce, less only its decay.
//
// "An obstacle bounce leaves speed and spin unchanged" (specs/playfield.md). So
// across the bounce the spin changes by the decay alone:
// `spin_after = spin_before * 0.5 ^ (elapsed / SPIN_HALFLIFE)`,
// with `elapsed` the simulation time between the two readings, which the
// snapshot's own `simTime` gives.
//
// A spinning ball is posed level with obstacle A's left face and sent at it on
// a field holding that ball and that one obstacle: obstacle B is REMOVED
// rather than avoided, so the bounce whose spin is read comes off the face this
// point names, and both paddles — which cannot be removed — are driven clear
// of the shot and held still, because a paddle hit is the one contact that
// would legitimately change the spin. The reading is taken on the frame the
// normal component reverses.

import { afterEach, beforeEach, it } from "vitest";
import { OBSTACLES, OBSTACLE_CENTERS, SPIN_HALFLIFE } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  arrangeObstacleBounce,
  ball0,
  captureReplay,
  createHarness,
  driveObstacleBounce,
  enterPlaying,
  spinBall,
  type Harness,
} from "../harness";

/** Which obstacle the shot is at, and the face it strikes. */
const OBSTACLE = 0;
/** The approach, in units per second. */
const APPROACH_SPEED = 400;
const POSED_SPIN = 200;
/** The review item's margin: two percent of the decayed spin. */
const RELATIVE_TOLERANCE = 0.02;
/** Frames recorded after the reading, so the clip shows the ball leaving. */
const DEPARTURE_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("keeps the spin through an obstacle bounce, less the decay", async () => {
  enterPlaying(harness);
  arrangeObstacleBounce(harness, {
    obstacle: OBSTACLE,
    faceX: OBSTACLES[OBSTACLE].x0,
    y: OBSTACLE_CENTERS[OBSTACLE].y,
    from: "left",
    speed: APPROACH_SPEED,
  });
  spinBall(harness, POSED_SPIN);
  const before = harness.snapshot();

  const bounce = await captureReplay(harness, "bounce", async () => {
    const reflected = await driveObstacleBounce(harness, "left");
    await harness.advance(DEPARTURE_TICKS);
    return reflected;
  });

  assertEqual(bounce.hit, true);
  const elapsed = bounce.snapshot.simTime - before.simTime;
  const expected = ball0(before).spin * Math.pow(0.5, elapsed / SPIN_HALFLIFE);
  assertLessThanOrEqual(
    Math.abs(ball0(bounce.snapshot).spin - expected),
    Math.abs(expected) * RELATIVE_TOLERANCE,
  );
});
