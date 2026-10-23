// ball/no-tunnel-wall — at the ceiling speed the ball still reflects off a
// wall, never leaving the field.
//
// The ball is fired straight up the field's center line at the top wall at
// `SPEED_CAP` and the frame of the rebound is read: the ball is travelling back
// down and its center is inside the field. With the sub-step rule
// (specs/balls.md, and `./no-tunnel.ts`) the ball is never outside; a build
// that integrates a whole coarse frame at once puts it there. Every frame is
// sampled, so the earliest frame the ball was travelling back is the one read.
//
// The field is emptied to this ball alone: a wall is not a body that can be
// spawned, so nothing else belongs on the field for a check about one. The
// paddles cannot be removed, so they are parked out of the lane.

import { afterEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { BALL_R, FIELD_CX, FIELD_H, SPEED_CAP } from "../constants";
import {
  ball0,
  captureReplay,
  clearPaddles,
  isolateBall,
  placeBall,
  type Harness,
} from "../harness";
import { DEPARTURE_MS, framesFor, harnessAt, STEPS_MS } from "./no-tunnel";

const START_Y = 600;

const live: Harness[] = [];

afterEach(async () => {
  for (const harness of live.splice(0)) await harness.dispose();
});

it("rebounds off a wall at the ceiling speed and stays on the field", async () => {
  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs, live);
    await isolateBall(harness);
    await clearPaddles(harness);
    await placeBall(harness, { x: FIELD_CX, y: START_Y, vy: -SPEED_CAP });

    const rebound = await captureReplay(harness, "fast", async () => {
      const swept = await harness.until((s) => ball0(s).vy > 0, {
        maxFrames: framesFor(START_Y, stepMs),
        poll: 1,
      });
      await harness.advance(Math.ceil(DEPARTURE_MS / stepMs));
      return swept;
    });

    assertEqual(rebound.hit, true, `${stepMs} ms frames: rebounds`);
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
