// gameplay/serve-angle — a served ball leaves at the serve angle.
//
// A fresh match is started and its pre-serve hold expired; the LAUNCH itself is
// the build's own, on the frame after, and the velocity is read the instant it
// happens, on the launch frame, on which the ball is not advanced
// (specs/balls.md). The serve is `vx = dir * SERVE_SPEED * cos(SERVE_ANGLE)`,
// `vy = s * SERVE_SPEED * sin(SERVE_ANGLE)` with `s` either sign, so the angle
// from horizontal has magnitude SERVE_ANGLE exactly; the sign is the build's.

import { afterEach, beforeEach, it } from "vitest";
import { SERVE_ANGLE } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual, assertNotEqual } from "../assert";
import {
  angleDeg,
  ball0,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

const SERVE_ANGLE_DEG = (SERVE_ANGLE * 180) / Math.PI;
/** The review item's margin, in degrees. */
const ANGLE_TOLERANCE_DEG = 2;

/** Frames of the pre-serve hold recorded before the hold is expired. */
const HELD_TICKS = 24; // 0.2 s
/** Frames of the served flight recorded after the launch. */
const FLIGHT_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("serves the ball at SERVE_ANGLE from horizontal", async () => {
  const { debug } = harness;
  debug.reset();
  await harness.advance(1);
  debug.startMatch("versus");
  // One advanced frame settles each screen change (specs/instrumentation.md),
  // so everything below acts on the open match.
  await harness.advance(1);

  const launched = await captureReplay(harness, "serve", async () => {
    await harness.advance(HELD_TICKS);
    debug.serve();

    const swept = await harness.until((s) => s.screen === "playing", {
      maxFrames: 60,
      poll: 1,
    });
    await harness.advance(FLIGHT_TICKS);
    return swept;
  });

  assertEqual(launched.hit, true);
  const ball = ball0(launched.snapshot);
  assertNotEqual(ball.vx, 0);
  assertLessThanOrEqual(
    Math.abs(angleDeg(ball) - SERVE_ANGLE_DEG),
    ANGLE_TOLERANCE_DEG,
  );
});
