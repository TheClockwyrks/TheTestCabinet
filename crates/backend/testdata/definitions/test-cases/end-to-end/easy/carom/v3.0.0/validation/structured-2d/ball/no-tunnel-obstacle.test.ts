// ball/no-tunnel-obstacle — at the fastest the ball can ever travel, it still
// never passes through an obstacle.
//
// The probe speed is the spec's ceiling: a paddle bounce is capped at SPEED_CAP
// and nothing else raises speed, so a real rally can reach it and no more.
// Testing at the ceiling checks exactly what the integrator is required to
// survive: "the ball stays inside the field and on the outside of every paddle
// and obstacle at every speed up to SPEED_CAP" (specs/balls.md).
//
// WHY THE PROBE RUNS TWICE. The runtime hands the game whatever elapsed time
// the last frame really took, and specs/balls.md fixes the answer: the frame is
// cut into `ceil(speed * dt / MAX_SUBSTEP)` sub-steps of at most MAX_SUBSTEP
// units each, so no step ever carries the ball past a body. At the fine cadence
// the rest of this suite uses the ball moves about eight units a frame, less
// than the width of anything on the field, so the first probe would pass a
// build that never sub-steps. The coarse step below is an ordinary bad moment
// on a real machine (twenty frames a second), where one frame at the ceiling
// is forty-nine units, more than twice the width of what it strikes.
//
// The field holds obstacle A and one ball, and nothing else: the second
// obstacle is off the field rather than parked out of the way, so the only
// body the probe can meet is the one it was fired at. The obstacle clock is
// held at 0 and a frame advanced before the probe is aimed, so under `gyre`
// the face is standing where `OBSTACLES` puts it.

import { afterEach, it } from "vitest";
import { ConstantClock } from "@clockwyrks/structured-2d";
import {
  BALL_R,
  MAX_SUBSTEP,
  OBSTACLES,
  OBSTACLE_CENTERS,
  SPEED_CAP,
} from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  ball0,
  ballOps,
  captureReplay,
  createHarness,
  holdObstacleClock,
  openIsolatedPlay,
  parkPaddles,
  TICK_MS,
  type Harness,
} from "../harness";

/** The suite's own cadence, and a frame that carries the ball past an obstacle. */
const STEPS_MS = [TICK_MS, 50];

/** Obstacle A, in the order of `OBSTACLE_CENTERS`: the only one on field. */
const OBSTACLE = 0;
const FACE_X = OBSTACLES[OBSTACLE].x0;
const LANE_Y = OBSTACLE_CENTERS[OBSTACLE].y;
/** How far short of the face the probe starts, in logical units. */
const RUN_UP = 360;

/**
 * The sweep cap for a probe: the frames its run-up takes at the ceiling speed,
 * plus room for the contact itself, at the given step size.
 */
function framesFor(distance: number, stepMs: number): number {
  return Math.ceil((distance / SPEED_CAP) * (1000 / stepMs)) + 4;
}

/**
 * How much of the departing flight is recorded after the rebound, in ms of GAME
 * time: a duration, because the probe is driven at two very different frame
 * sizes. Short of the time a ball at the ceiling needs to reach the left goal
 * from the face, so the recording ends with the ball still in play.
 */
const DEPARTURE_MS = 350;

const live: Harness[] = [];

afterEach(() => {
  while (live.length > 0) live.pop()?.dispose();
});

/**
 * A harness stepping at `stepMs`, opened on live play over one ball and
 * obstacle A alone, with both paddles held out of the probe's lane.
 */
async function harnessAt(stepMs: number): Promise<Harness> {
  const harness = await createHarness({ clock: new ConstantClock(stepMs) });
  live.push(harness);
  await openIsolatedPlay(harness, {
    contents: { balls: 1, obstacles: [OBSTACLE] },
  });
  holdObstacleClock(harness, 0);
  await harness.advance(1);
  parkPaddles(harness);
  return harness;
}

it("rebounds off an obstacle at the ceiling speed", async () => {
  // The coarse frame really is the case the sub-step rule exists for.
  assertGreaterThan((SPEED_CAP * STEPS_MS[1]) / 1000, MAX_SUBSTEP);

  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs);
    const ops = ballOps(harness);
    ops.setBallPosition(FACE_X - RUN_UP, LANE_Y);
    ops.setBallVelocity(SPEED_CAP, 0);
    ops.setBallSpin(0);

    // Both probes are recorded under the one output, so the coarse step, the
    // frame long enough to carry the ball past a whole obstacle, is the one
    // that lands.
    const bank = await captureReplay(harness, "fast", async () => {
      const rebound = await harness.until((s) => ball0(s).vx < 0, {
        maxFrames: framesFor(RUN_UP - BALL_R, stepMs),
        poll: 1,
      });
      await harness.advance(Math.ceil(DEPARTURE_MS / stepMs));
      return rebound;
    });

    assertEqual(bank.hit, true, `${stepMs} ms frames: rebounds`);
    // Never on the far side: read on the earliest frame the ball was travelling
    // back, where "stays clear of the face" has to be read.
    assertLessThanOrEqual(
      ball0(bank.snapshot).x,
      FACE_X - BALL_R + 1e-6,
      `${stepMs} ms frames: stays clear`,
    );
  }
});
