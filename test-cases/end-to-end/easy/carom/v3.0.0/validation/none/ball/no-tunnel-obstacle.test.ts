// ball/no-tunnel-obstacle — at the ceiling speed the ball still reflects off an
// obstacle, never passing through it.
//
// The ball is fired level at obstacle A's left face at `SPEED_CAP` and the
// frame of the rebound is read: the ball is travelling back and its center is
// on the near side of the face. With the sub-step rule (specs/balls.md, and
// `./no-tunnel.ts`) the ball is never on the far side; a build that integrates
// a whole coarse frame at once puts it there. Every frame is sampled, so the
// earliest frame the ball was travelling back is the one read.

import { afterEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BALL_R, OBSTACLES, OBSTACLE_CENTERS, SPEED_CAP } from "../constants";
import { ball0, captureReplay, clearPaddles, type Harness } from "../harness";
import { DEPARTURE_MS, framesFor, harnessAt, STEPS_MS } from "./no-tunnel";

const FACE_X = OBSTACLES[0].x0;
const LANE_Y = OBSTACLE_CENTERS[0].y;
const RUN_UP = 360;

const live: Harness[] = [];

afterEach(async () => {
  for (const harness of live.splice(0)) await harness.dispose();
});

it("rebounds off an obstacle at the ceiling speed", async () => {
  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs, live);
    await clearPaddles(harness);
    await harness.debug.setBall(0, {
      x: FACE_X - RUN_UP,
      y: LANE_Y,
      vx: SPEED_CAP,
      vy: 0,
      spin: 0,
    });

    // Both probes are recorded under the one output, so the coarse step, the
    // one this point is about, is the one that lands.
    const bank = await captureReplay(harness, "fast", async () => {
      const rebound = await harness.until((s) => ball0(s).vx < 0, {
        maxFrames: framesFor(RUN_UP, stepMs),
        poll: 1,
      });
      await harness.advance(Math.ceil(DEPARTURE_MS / stepMs));
      return rebound;
    });

    assertEqual(bank.hit, true, `${stepMs} ms frames: rebounds`);
    assertLessThanOrEqual(
      ball0(bank.snapshot).x,
      FACE_X - BALL_R + 1e-6,
      `${stepMs} ms frames: stays clear of the face`,
    );
  }
});
