// ball/no-tunnel-paddle — at the fastest the ball can ever travel, it still
// never passes through a paddle.
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
// The field holds one ball and neither obstacle, so the only body between the
// probe and the goal it is fired at is the paddle this check is about: the
// struck paddle is driven onto the lane and the far one is held off it.

import { afterEach, it } from "vitest";
import { ConstantClock } from "@test-cabinet/structured-2d";
import {
  BALL_R,
  FIELD_CY,
  MAX_SUBSTEP,
  P1_X1,
  SPEED_CAP,
} from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  ball0,
  ballOps,
  captureReplay,
  createHarness,
  drivePaddle,
  openIsolatedPlay,
  parkPaddle,
  TICK_MS,
  type Harness,
} from "../harness";

/** The suite's own cadence, and a frame that carries the ball past a paddle. */
const STEPS_MS = [TICK_MS, 50];

/** Where the probe starts: down the mid-field lane, level with the paddle. */
const START_X = 760;

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

/**
 * A harness stepping at `stepMs`, opened on live play over one ball and an
 * otherwise empty field.
 */
async function harnessAt(stepMs: number): Promise<Harness> {
  const harness = await createHarness({ clock: new ConstantClock(stepMs) });
  live.push(harness);
  await openIsolatedPlay(harness);
  return harness;
}

it("rebounds off a paddle at the ceiling speed rather than scoring through it", async () => {
  assertGreaterThan((SPEED_CAP * STEPS_MS[1]) / 1000, MAX_SUBSTEP);

  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs);
    // The struck paddle stands still on the lane; the far one is held off it so
    // it cannot interfere.
    drivePaddle(harness, "left", { cy: FIELD_CY, vy: 0 });
    parkPaddle(harness, "right");
    const ops = ballOps(harness);
    ops.setBallPosition(START_X, FIELD_CY);
    ops.setBallVelocity(-SPEED_CAP, 0);
    ops.setBallSpin(0);

    const rebound = await captureReplay(harness, "fast", async () => {
      const swept = await harness.until((s) => ball0(s).vx > 0, {
        maxFrames: framesFor(START_X - P1_X1 - BALL_R, stepMs),
        poll: 1,
      });
      await harness.advance(Math.ceil(DEPARTURE_MS / stepMs));
      return swept;
    });

    assertEqual(rebound.hit, true, `${stepMs} ms frames: rebounds`);
    assertEqual(
      rebound.snapshot.screen,
      "playing",
      `${stepMs} ms frames: no point`,
    );
    // Never behind the paddle: off its front face, on the field side.
    assertGreaterThanOrEqual(
      ball0(rebound.snapshot).x,
      P1_X1 + BALL_R - 1e-6,
      `${stepMs} ms frames: stays in front of the paddle`,
    );
  }
});
