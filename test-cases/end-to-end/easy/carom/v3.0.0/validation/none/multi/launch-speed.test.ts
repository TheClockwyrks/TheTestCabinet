// multi/launch-speed — a launched ball leaves at SERVE_SPEED (specs/balls.md).
//
// A match is opened, the field is cleared back to the three balls this point is
// about — each on its own home, held, with a full timer — and their holds are cut
// short; the LAUNCH itself is the build's own, on the frame after, and the speed
// of every ball is read the instant it happens, before a wall, a paddle or
// another ball could change it. Nothing about the launch is posed: ending a hold
// arranges the launch and the build's own rule performs it.
//
// The obstacles come off the field with everything else. Nothing on it is struck
// before the reading, and the recorded flight after it is three balls crossing an
// empty field at one speed — which is the picture the review point names.
//
// All three are read, because in multi they leave together and a build that
// launched one of them at the wrong speed would otherwise be graded on the two it
// got right. The ANGLE is not read here: it is drawn over the full circle, which
// is `multi/launch-angle`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThanOrEqual } from "../assert";
import { BALL_COUNT, SERVE_SPEED } from "../constants";
import {
  captureReplay,
  createMultiHarness,
  endHolds,
  openCountdown,
  type MultiHarness,
} from "../harness";
import { isolateBalls, readBalls } from "./harness";

/**
 * The margin the speed is allowed: one percent of `SERVE_SPEED`, rounding room
 * on a launch the specification fixes exactly.
 */
const SPEED_TOLERANCE = SERVE_SPEED * 0.01;

/** Frames of the hold recorded before it is cut short. */
const HELD_TICKS = 24; // 0.2 s

/** Frames of the launched flight recorded after the launch. */
const FLIGHT_TICKS = 90; // 0.75 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("launches every ball at the base launch speed", async () => {
  await openCountdown(h, "versus");
  await isolateBalls(h);

  const launched = await captureReplay(h, "launch", async () => {
    await h.advance(HELD_TICKS);
    await endHolds(h);

    const swept = await h.until((s) => s.screen === "playing", {
      maxFrames: 60,
      poll: 1,
    });
    // Read HERE, on the launch frame, before anything on the field could have
    // changed a speed.
    const balls = readBalls(swept.snapshot);
    await h.advance(FLIGHT_TICKS);
    return { swept, balls };
  });

  assertEqual(launched.swept.hit, true);
  assertLength(launched.balls, BALL_COUNT);
  for (const ball of launched.balls) {
    assertEqual(ball.held, false);
    assertLessThanOrEqual(Math.abs(ball.speed - SERVE_SPEED), SPEED_TOLERANCE);
  }
});
