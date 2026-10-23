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
//
// The field is emptied to this ball alone, so the struck paddle is the only
// body the shot can meet. Neither paddle is taken from the player: what this
// check needs of the left one is that it STAND there, and in a Versus match
// with no key held it stands exactly where it was put. The right one is parked
// off the lane, since a paddle cannot be removed.

import { afterEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FIELD_CY, P1_X1, SPEED_CAP } from "../constants";
import {
  ball0,
  captureReplay,
  isolateBall,
  PARKED_CY,
  placeBall,
  type Harness,
} from "../harness";
import { DEPARTURE_MS, framesFor, harnessAt, STEPS_MS } from "./no-tunnel";

const START_X = 760;

const live: Harness[] = [];

afterEach(async () => {
  for (const harness of live.splice(0)) await harness.dispose();
});

it("rebounds off a paddle at the ceiling speed rather than scoring through it", async () => {
  for (const stepMs of STEPS_MS) {
    const harness = await harnessAt(stepMs, live);
    await isolateBall(harness);
    // The struck paddle stands in the lane; the far one is parked out of it.
    await harness.debug.setPaddleCy("left", FIELD_CY);
    await harness.debug.setPaddleCy("right", PARKED_CY);
    await placeBall(harness, { x: START_X, y: FIELD_CY, vx: -SPEED_CAP });

    const rebound = await captureReplay(harness, "fast", async () => {
      const swept = await harness.until((s) => ball0(s).vx > 0, {
        maxFrames: framesFor(START_X - P1_X1, stepMs),
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
    assertGreaterThan(
      ball0(rebound.snapshot).x,
      P1_X1,
      `${stepMs} ms frames: stays on the field side of the paddle`,
    );
  }
});
