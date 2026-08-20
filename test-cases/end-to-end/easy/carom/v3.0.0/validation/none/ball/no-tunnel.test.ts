// ball/no-tunnel — at the fastest the ball can ever travel, it still never passes
// through an obstacle, a paddle, or a wall.
//
// The probe speed is the spec's ceiling: a paddle bounce is capped there and
// nothing else raises speed, so a real rally can reach it and no more. Testing at
// the ceiling checks exactly what the integrator is required to survive, rather
// than an impossible value no build is obliged to handle.
//
// WHY EACH PROBE RUNS TWICE. Under this runtime the SIZE of a frame is not the
// build's to choose: the runtime hands the game whatever elapsed time the last
// frame really took, and a game that resolves collisions once per frame is safe
// only while that time stays small. At the fine cadence the rest of this suite
// uses, a ball at the ceiling speed moves eight pixels a frame — less than the
// width of every object on the field, so nothing tunnels whatever the build does
// and the check would be vacuous. The coarse step below is an ordinary bad
// moment on a real machine (twenty frames a second, well inside the runtime's own
// delta clamp), and there the ball crosses far more than an obstacle's width in
// one frame. A build that sub-steps its integration is unaffected; a build that
// integrates once per frame puts the ball out the far side.

import { afterEach, expect, it } from "vitest";
import { ConstantClock } from "@test-cabinet/simple-2d";
import {
  BALL_R,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  OBSTACLES,
  OBSTACLE_CENTERS,
  P1_X1,
  SPEED_CAP,
} from "../../src/constants";
import {
  PARKED_CY,
  TICK_MS,
  clearPaddles,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * The two frame sizes each probe is driven at: the suite's own cadence, and a
 * frame long enough that one step of it carries the ball past a whole obstacle.
 */
const STEPS_MS = [TICK_MS, 50];

const FACE_X = OBSTACLES[0].x0;
const LANE_Y = OBSTACLE_CENTERS[0].y;

/** How far short of what it strikes each probe starts, in logical px. */
const OBSTACLE_RUN_UP = 360;
const PADDLE_START_X = 760;
const WALL_START_Y = 600;

/**
 * The sweep cap for a probe: the frames its run-up takes at the ceiling speed,
 * plus room for the contact itself. Stated as a distance so it means the same
 * thing at every step size.
 */
function framesFor(distance: number, stepMs: number): number {
  return Math.ceil((distance / SPEED_CAP) * (1000 / stepMs)) + 4;
}

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

it("rebounds off an obstacle at the ceiling speed", async () => {
  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs);
    clearPaddles(harness);
    harness.debug.setBall(0, {
      x: FACE_X - OBSTACLE_RUN_UP,
      y: LANE_Y,
      vx: SPEED_CAP,
      vy: 0,
      spin: 0,
    });

    const bank = await harness.until((s) => s.ball.vx < 0, {
      maxFrames: framesFor(OBSTACLE_RUN_UP - BALL_R, stepMs),
      poll: 1,
    });

    expect(bank.hit, `${stepMs} ms frames: rebounds`).toBe(true);
    expect(
      bank.snapshot.ball.x,
      `${stepMs} ms frames: stays clear`,
    ).toBeLessThan(FACE_X);
  }
});

it("rebounds off a paddle at the ceiling speed rather than scoring through it", async () => {
  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs);
    // The run-up rides the mid-field lane, which clears both obstacles; the far
    // paddle is parked out of it so it cannot interfere.
    harness.debug.setPaddle("left", { cy: FIELD_CY, vy: 0 });
    harness.debug.setPaddle("right", { cy: PARKED_CY, vy: 0 });
    harness.debug.setBall(0, {
      x: PADDLE_START_X,
      y: FIELD_CY,
      vx: -SPEED_CAP,
      vy: 0,
      spin: 0,
    });

    const rebound = await harness.until((s) => s.ball.vx > 0, {
      maxFrames: framesFor(PADDLE_START_X - P1_X1 - BALL_R, stepMs),
      poll: 1,
    });

    expect(rebound.hit, `${stepMs} ms frames: rebounds`).toBe(true);
    expect(rebound.snapshot.screen, `${stepMs} ms frames: no point`).toBe(
      "playing",
    );
    expect(
      rebound.snapshot.ball.x,
      `${stepMs} ms frames: stays on the field`,
    ).toBeGreaterThan(0);
  }
});

it("rebounds off a wall at the ceiling speed and stays on the field", async () => {
  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs);
    clearPaddles(harness);
    // Straight up the field's centre line, clear of both obstacles.
    harness.debug.setBall(0, {
      x: FIELD_CX,
      y: WALL_START_Y,
      vx: 0,
      vy: -SPEED_CAP,
      spin: 0,
    });

    const rebound = await harness.until((s) => s.ball.vy > 0, {
      maxFrames: framesFor(WALL_START_Y - BALL_R, stepMs),
      poll: 1,
    });

    expect(rebound.hit, `${stepMs} ms frames: rebounds`).toBe(true);
    expect(
      rebound.snapshot.ball.y,
      `${stepMs} ms frames: below the wall`,
    ).toBeGreaterThan(0);
    expect(
      rebound.snapshot.ball.y,
      `${stepMs} ms frames: on the field`,
    ).toBeLessThan(FIELD_H);
  }
});
