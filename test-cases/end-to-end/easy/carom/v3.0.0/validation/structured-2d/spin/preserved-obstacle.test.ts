// spin/preserved-obstacle — spin survives an obstacle bounce, less only its decay.
//
// "An obstacle bounce leaves speed and spin unchanged" (specs/playfield.md). So across the bounce the spin changes by
// the decay alone: `spin_after = spin_before * 0.5 ^ (elapsed / SPIN_HALFLIFE)`,
// with `elapsed` the simulation time between the two readings, which the
// snapshot's own `simTime` gives. A spinning ball is posed level with obstacle
// A's left face, travelling at it, and the spin is read on the frame the normal
// component reverses.
//
// The field holds obstacle A and that one ball, and nothing else: the second
// obstacle is off the field rather than parked out of the way, so the bounce
// the sweep stops on can only be the one this check is about. The obstacle
// clock is held at 0 and a frame advanced before the ball is posed, so under
// `gyre` the face is standing where `OBSTACLES` puts it.

import { afterEach, beforeEach, it } from "vitest";
import { OBSTACLES, OBSTACLE_CENTERS, SPIN_HALFLIFE } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  ball0,
  ballOps,
  captureReplay,
  createHarness,
  holdObstacleClock,
  openIsolatedPlay,
  parkPaddles,
  type Harness,
} from "../harness";

/** Obstacle A, in the order of `OBSTACLE_CENTERS`: the only one on field. */
const OBSTACLE = 0;
/** The lane the shot runs down: level with obstacle A's centre. */
const LANE_Y = OBSTACLE_CENTERS[OBSTACLE].y;
/** How far short of the struck face the ball is posed, and how fast it goes. */
const RUN_UP = 180;
const SPEED = 400;
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
  await openIsolatedPlay(harness, {
    contents: { balls: 1, obstacles: [OBSTACLE] },
  });
  holdObstacleClock(harness, 0);
  // One frame, so a gyre build has recomputed the obstacle's pose from the held
  // clock before the shot is aimed at where the case says the face is.
  await harness.advance(1);
  parkPaddles(harness);
  const ops = ballOps(harness);
  ops.setBallPosition(OBSTACLES[OBSTACLE].x0 - RUN_UP, LANE_Y);
  ops.setBallVelocity(SPEED, 0);
  ops.setBallSpin(POSED_SPIN);
  const before = harness.snapshot();

  const bounce = await captureReplay(harness, "bounce", async () => {
    const reflected = await harness.until((s) => ball0(s).vx < 0, {
      maxFrames: 240,
      poll: 1,
    });
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
