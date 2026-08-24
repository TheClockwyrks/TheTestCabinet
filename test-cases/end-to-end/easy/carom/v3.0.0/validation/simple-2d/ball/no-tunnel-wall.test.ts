// ball/no-tunnel-wall — at the fastest the ball can ever travel, it still never
// passes through a wall.
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

import { afterEach, it } from "vitest";
import { ConstantClock } from "@test-cabinet/simple-2d";
import {
  BALL_R,
  FIELD_CX,
  FIELD_H,
  MAX_SUBSTEP,
  SPEED_CAP,
} from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  ball0,
  captureReplay,
  clearPaddles,
  createHarness,
  startPlaying,
  TICK_MS,
  type Harness,
} from "../harness";

/** The suite's own cadence, and a frame that carries the ball past a wall. */
const STEPS_MS = [TICK_MS, 50];

/** Where the probe starts, straight up the center line, clear of both obstacles. */
const START_Y = 600;

/** The sweep cap for a probe, at the given step size. */
function framesFor(distance: number, stepMs: number): number {
  return Math.ceil((distance / SPEED_CAP) * (1000 / stepMs)) + 4;
}

/** Game time recorded after the rebound, as a duration (see the sibling). */
const DEPARTURE_MS = 350;

const live: Harness[] = [];

afterEach(() => {
  while (live.length > 0) live.pop()?.dispose();
});

async function harnessAt(stepMs: number): Promise<Harness> {
  const harness = await createHarness({ clock: new ConstantClock(stepMs) });
  live.push(harness);
  await startPlaying(harness);
  return harness;
}

it("rebounds off a wall at the ceiling speed and stays on the field", async () => {
  assertGreaterThan((SPEED_CAP * STEPS_MS[1]) / 1000, MAX_SUBSTEP);

  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs);
    clearPaddles(harness);
    harness.debug.setBall(0, {
      x: FIELD_CX,
      y: START_Y,
      vx: 0,
      vy: -SPEED_CAP,
      spin: 0,
    });

    const rebound = await captureReplay(harness, "fast", async () => {
      const swept = await harness.until((s) => ball0(s).vy > 0, {
        maxFrames: framesFor(START_Y - BALL_R, stepMs),
        poll: 1,
      });
      await harness.advance(Math.ceil(DEPARTURE_MS / stepMs));
      return swept;
    });

    assertEqual(rebound.hit, true, `${stepMs} ms frames: rebounds`);
    // Never outside the field: the center stays a radius inside both walls.
    assertGreaterThanOrEqual(
      ball0(rebound.snapshot).y,
      BALL_R - 1e-6,
      `${stepMs} ms frames: inside the top wall`,
    );
    assertLessThanOrEqual(
      ball0(rebound.snapshot).y,
      FIELD_H - BALL_R + 1e-6,
      `${stepMs} ms frames: inside the bottom wall`,
    );
  }
});
