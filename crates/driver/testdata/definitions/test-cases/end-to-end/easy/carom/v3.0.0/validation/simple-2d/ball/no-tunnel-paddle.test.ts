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
// The field holds the probe ball alone: both obstacles are removed rather than
// dodged, so the only body the ball can meet on its way down the lane is the
// paddle the point is about. The struck paddle is PLACED at the field centre
// and left the player's — `setPaddleCy` sets the centre and takes nothing —
// because what is under test is the collision, not who is moving the paddle,
// and an idle player's paddle stands exactly where it was put. The far paddle
// is left alone for the same reason: the probe travels away from it and never
// comes within six hundred units of its face.

import { afterEach, it } from "vitest";
import { ConstantClock } from "@clockwyrks/simple-2d";
import { BALL_R, FIELD_CY, MAX_SUBSTEP, P1_X1, SPEED_CAP } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  aimBall,
  ball0,
  captureReplay,
  createHarness,
  enterPlaying,
  placeBall,
  placePaddle,
  poseWorld,
  spinBall,
  TICK_MS,
  type Harness,
} from "../harness";

/** The suite's own cadence, and a frame that carries the ball past a paddle. */
const STEPS_MS = [TICK_MS, 50];

/**
 * Where the probe starts, level with the struck paddle: far enough back that
 * even the coarse frame below spends whole frames approaching rather than
 * landing already overlapping the paddle.
 */
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

async function harnessAt(stepMs: number): Promise<Harness> {
  const harness = await createHarness({ clock: new ConstantClock(stepMs) });
  live.push(harness);
  enterPlaying(harness);
  return harness;
}

it("rebounds off a paddle at the ceiling speed rather than scoring through it", async () => {
  assertGreaterThan((SPEED_CAP * STEPS_MS[1]) / 1000, MAX_SUBSTEP);

  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs);
    poseWorld(harness);
    placePaddle(harness, "left", FIELD_CY);
    placeBall(harness, START_X, FIELD_CY);
    aimBall(harness, -SPEED_CAP, 0);
    spinBall(harness, 0);

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
