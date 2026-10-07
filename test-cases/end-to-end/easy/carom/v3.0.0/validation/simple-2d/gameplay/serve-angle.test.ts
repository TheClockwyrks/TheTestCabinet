// gameplay/serve-angle — a served ball leaves at the serve angle.
//
// A fresh match is opened on its countdown and its pre-serve hold cut to nothing;
// the LAUNCH itself is the build's own, on the frame after, and the velocity is
// read the instant it happens, on the launch frame, on which the ball is not
// advanced (specs/balls.md). The serve is
// `vx = dir * SERVE_SPEED * cos(SERVE_ANGLE)`,
// `vy = s * SERVE_SPEED * sin(SERVE_ANGLE)` with `s` either sign, so the angle
// from horizontal has magnitude SERVE_ANGLE exactly; the sign is the build's.
//
// The field holds the one ball whose serve is the subject, spawned back HELD at
// its home with a full hold timer: both obstacles are removed, so the recorded
// flight after the reading crosses an empty court. Nothing is taken from the
// player — no paddle is driven, and neither of them can reach the ball inside the
// three quarters of a second recorded.

import { afterEach, beforeEach, it } from "vitest";
import { SERVE_ANGLE } from "../constants";
import { assertEqual, assertLessThanOrEqual, assertNotEqual } from "../assert";
import {
  angleDeg,
  ball0,
  captureReplay,
  createHarness,
  driveServe,
  openCountdown,
  poseWorld,
  stageServe,
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
  openCountdown(harness, "versus");
  poseWorld(harness, { live: false });

  const launched = await captureReplay(harness, "serve", async () => {
    await harness.advance(HELD_TICKS);
    stageServe(harness);
    const swept = await driveServe(harness);
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
