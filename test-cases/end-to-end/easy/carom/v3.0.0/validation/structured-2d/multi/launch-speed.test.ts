// multi/launch-speed — a launched ball leaves at the base launch speed.
//
// A fresh match is opened over the three balls alone and their holds cut short;
// the LAUNCH itself is the build's own, on the frame after, and the speed of
// every ball is read the instant it happens — before a wall, a paddle or another
// ball could change it. Nothing about the launch is posed: the countdown is
// reached through the surface and the holds are ended, and what leaves is
// whatever the build's own launch produced.
//
// All three are read, because in multi they leave together and a build that
// launched one of them at the wrong speed would otherwise be graded on the two it
// got right. The ANGLE is not read here: it is drawn over the full circle, which
// is `multi/launch-angle`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_COUNT, SERVE_SPEED } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolateField,
  openCountdown,
  reachPlay,
  type Harness,
} from "../harness";
import { readEveryBall } from "./harness";

/** The review item's margin: one percent of the specified speed. */
const SPEED_TOLERANCE = SERVE_SPEED * 0.01;

/** Frames of the hold recorded before it is cut short. */
const HELD_TICKS = 24; // 0.2 s

/** Frames of the launched flight recorded after the launch. */
const FLIGHT_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches every ball at the base launch speed", async () => {
  await openCountdown(h, "versus");
  // The three balls and nothing else: a speed read on the launch frame has met
  // nothing, so nothing else needs to be on the field for it.
  isolateField(h, { balls: BALL_COUNT });

  const launched = await captureReplay(h, "launch", async () => {
    await h.advance(HELD_TICKS);
    const swept = await reachPlay(h);
    // Read HERE, on the launch frame, before anything on the field could have
    // changed a speed.
    const balls = readEveryBall(swept.snapshot);
    await h.advance(FLIGHT_TICKS);
    return { swept, balls };
  });

  assertEqual(launched.swept.hit, true);
  for (const ball of launched.balls) {
    assertEqual(ball.held, false);
    assertLessThanOrEqual(Math.abs(ball.speed - SERVE_SPEED), SPEED_TOLERANCE);
  }
});
