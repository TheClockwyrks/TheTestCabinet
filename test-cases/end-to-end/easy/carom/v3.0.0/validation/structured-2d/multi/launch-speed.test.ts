// multi/launch-speed — a launched ball leaves at the base launch speed.
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
import { SERVE_SPEED } from "../../src/constants";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { readBalls } from "./harness";

/** The margin the speed is allowed: 15% of the specified speed. */
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
  h.debug.reset();
  await h.advance(1);
  h.debug.startMatch("versus");
  // One advanced frame settles the screen change (specs/instrumentation.md),
  // so the clip below records the countdown.
  await h.advance(1);

  const launched = await captureReplay(h, "launch", async () => {
    await h.advance(HELD_TICKS);
    h.debug.serve();

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
  assertDeepEqual(h.assetFailures, []);
});
