// multi/launch-speed — a launched ball leaves at SERVE_SPEED (specs/balls.md).
//
// A fresh match is opened and its hold cut short; the LAUNCH itself is the
// build's own, on the frame after, and the speed of every ball is read the
// instant it happens — before a wall, a paddle or another ball could change it.
// Nothing about the launch is posed: `startMatch` opens the countdown and `serve`
// ends it, and what leaves is whatever the build's own launch produced.
//
// All three are read, because in multi they leave together and a build that
// launched one of them at the wrong speed would otherwise be graded on the two it
// got right. The ANGLE is not read here: it is drawn over the full circle, which
// is `multi/launch-angle`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import { SERVE_SPEED } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { readBalls } from "./harness";

/**
 * The margin the speed is allowed: one percent of `SERVE_SPEED`, rounding room
 * on a launch the specification fixes exactly.
 */
const SPEED_TOLERANCE = SERVE_SPEED * 0.01;

/** Frames of the hold recorded before it is cut short. */
const HELD_TICKS = 24; // 0.2 s

/** Frames of the launched flight recorded after the launch. */
const FLIGHT_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("launches every ball at the base launch speed", async () => {
  await h.debug.reset();
  await h.debug.startMatch("versus");

  const launched = await captureReplay(h, "launch", async () => {
    await h.advance(HELD_TICKS);
    await h.debug.serve();

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
  for (const ball of launched.balls) {
    assertEqual(ball.held, false);
    assertLessThanOrEqual(Math.abs(ball.speed - SERVE_SPEED), SPEED_TOLERANCE);
  }
  // And the page stayed quiet throughout: nothing the build threw, and nothing it
  // logged as an error, while this harness was driving it.
  assertDeepEqual(h.pageErrors, []);
});
