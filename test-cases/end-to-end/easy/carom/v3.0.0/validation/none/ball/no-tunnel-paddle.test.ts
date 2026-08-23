// ball/no-tunnel-paddle — at the ceiling speed the ball still reflects off a
// paddle, never passing through it to score.
//
// The ball is fired level down the mid-field lane at the left paddle's front
// face at `SPEED_CAP` and the frame of the rebound is read: the ball is
// travelling back, its center is on the field side of the paddle, and no point
// was scored. With the sub-step rule (specs/balls.md, and `./no-tunnel.ts`)
// the ball is never behind the paddle; a build that integrates a whole coarse
// frame at once puts it there, or out of the goal. Every frame is sampled, so
// the earliest frame the ball was travelling back is the one read.

import { afterEach, expect, it } from "vitest";
import { FIELD_CY, P1_X1, SPEED_CAP } from "../constants";
import { ball0, captureReplay, PARKED_CY, type Harness } from "../harness";
import { DEPARTURE_MS, framesFor, harnessAt, STEPS_MS } from "./no-tunnel";

const START_X = 760;

const live: Harness[] = [];

afterEach(async () => {
  for (const harness of live.splice(0)) await harness.dispose();
});

it("rebounds off a paddle at the ceiling speed rather than scoring through it", async () => {
  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs, live);
    // The far paddle is parked out of the lane so it cannot interfere.
    await harness.debug.setPaddle("left", { cy: FIELD_CY, vy: 0 });
    await harness.debug.setPaddle("right", { cy: PARKED_CY, vy: 0 });
    await harness.debug.setBall(0, {
      x: START_X,
      y: FIELD_CY,
      vx: -SPEED_CAP,
      vy: 0,
      spin: 0,
    });

    const rebound = await captureReplay(harness, "fast", async () => {
      const swept = await harness.until((s) => ball0(s).vx > 0, {
        maxFrames: framesFor(START_X - P1_X1, stepMs),
        poll: 1,
      });
      await harness.advance(Math.ceil(DEPARTURE_MS / stepMs));
      return swept;
    });

    expect(rebound.hit, `${stepMs} ms frames: rebounds`).toBe(true);
    expect(rebound.snapshot.screen, `${stepMs} ms frames: no point`).toBe(
      "playing",
    );
    expect(
      ball0(rebound.snapshot).x,
      `${stepMs} ms frames: stays on the field side of the paddle`,
    ).toBeGreaterThan(P1_X1);
  }
});
