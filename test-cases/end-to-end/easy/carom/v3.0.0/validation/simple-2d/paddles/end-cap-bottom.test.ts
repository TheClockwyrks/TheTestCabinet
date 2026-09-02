// paddles/end-cap-bottom — a paddle's bottom end cap reflects the ball like a
// wall.
//
// specs/balls.md: a contact whose struck face is the paddle's bottom face is
// resolved like a wall. The ball is placed `BALL_R` off that face, `vy` is
// reversed, and speed and spin are unchanged. A paddle hit's bounce formula
// does not apply, so the ball leaves the way it came, still travelling
// vertically, rather than toward the opponent.
//
// The ball climbs straight up the left paddle's own x span, so the struck face
// is decided by the penetration depths alone: the bottom depth is at most one
// sub-step of travel while the left and right depths are the half-span plus
// `BALL_R`. Placement is read at the end of the contact frame, within one frame
// of travel of `cy + PADDLE_HALF + BALL_R`, on the field side of it.

import { afterEach, beforeEach, it } from "vitest";
import {
  BALL_R,
  FIELD_CY,
  P1_X0,
  P1_X1,
  PADDLE_HALF,
} from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  ball0,
  captureReplay,
  clearPaddles,
  createHarness,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The approach, in units per second; one frame of it bounds the placement. */
const SPEED = 400;
const FRAME_TRAVEL = SPEED / TICK_HZ;
/** Where the center rests off the bottom cap. */
const PLACED = FIELD_CY + PADDLE_HALF + BALL_R;
/** Half a second of approach, so the clip opens on a ball in flight. */
const START_Y = PLACED + SPEED / 2;
/** The middle of the paddle's x span. */
const CAP_X = (P1_X0 + P1_X1) / 2;

/** Frames of the returning flight recorded after the reflection. */
const RETURN_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reflects a ball climbing into the paddle's bottom cap", async () => {
  await startPlaying(h);
  clearPaddles(h);
  h.debug.setPaddle("left", { cy: FIELD_CY, vy: 0 });
  h.debug.setBall(0, { x: CAP_X, y: START_Y, vx: 0, vy: -SPEED, spin: 0 });
  const before = ball0(h.snapshot());

  const bounce = await captureReplay(h, "bounce", async () => {
    const reflected = await h.until((s) => ball0(s).vy > 0, {
      maxFrames: 120,
      poll: 1,
    });
    await h.advance(RETURN_TICKS);
    return reflected;
  });

  assertEqual(bounce.hit, true);
  const ball = ball0(bounce.snapshot);
  assertCloseTo(ball.vy, -before.vy, 6);
  assertCloseTo(ball.vx, before.vx, 6);
  assertCloseTo(ball.speed, before.speed, 6);
  assertCloseTo(ball.spin, 0, 6);
  assertGreaterThanOrEqual(ball.y, PLACED - 1e-6);
  assertLessThanOrEqual(ball.y, PLACED + FRAME_TRAVEL);
});
