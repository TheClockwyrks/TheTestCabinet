// gameplay/serve-angle — a served ball leaves at the serve angle.
//
// A fresh match is opened on its countdown and the ball's pre-serve hold is cut
// to zero; the LAUNCH itself is the build's own, on the frame after, and the
// velocity is read the instant it happens, on the launch frame, on which the ball
// is not advanced (specs/balls.md). Nothing about the serve is posed: ending a
// hold says nothing about the direction the ball leaves in. The serve is
// `vx = dir * SERVE_SPEED * cos(SERVE_ANGLE)`,
// `vy = s * SERVE_SPEED * sin(SERVE_ANGLE)` with `s` either sign, so the angle
// from horizontal has magnitude SERVE_ANGLE exactly; the sign is the build's.
//
// THE FIELD HOLDS THE ONE HELD BALL AND NOTHING ELSE. A serve is what this point
// is about, so the obstacles come off the field: the reading is taken on the
// launch frame, and the flight recorded after it is a serve travelling rather
// than a serve banking off furniture the check never aimed at. Neither paddle is
// taken from anyone — nothing here presses a key, and the launch is read before
// the ball has travelled at all.

import { afterEach, beforeEach, it } from "vitest";
import { SERVE_ANGLE } from "../constants";
import { assertEqual, assertLessThanOrEqual, assertNotEqual } from "../assert";
import {
  angleDeg,
  ball0,
  captureReplay,
  createHarness,
  isolateField,
  openCountdown,
  reachPlay,
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
  await openCountdown(harness, "versus");
  isolateField(harness);

  const launched = await captureReplay(harness, "serve", async () => {
    await harness.advance(HELD_TICKS);
    // The hold is cut to zero and the build's own rule launches on the frame
    // after; `reachPlay` stops on that frame.
    const swept = await reachPlay(harness);
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
