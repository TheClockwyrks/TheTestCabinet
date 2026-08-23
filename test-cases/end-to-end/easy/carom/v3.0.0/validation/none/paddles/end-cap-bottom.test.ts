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

import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_R, FIELD_CY, P1_X0, P1_X1, PADDLE_HALF } from "../constants";
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

afterEach(async () => {
  await h.dispose();
});

it("reflects a ball climbing into the paddle's bottom cap", async () => {
  await startPlaying(h);
  await clearPaddles(h);
  await h.debug.setPaddle("left", { cy: FIELD_CY, vy: 0 });
  await h.debug.setBall(0, {
    x: CAP_X,
    y: START_Y,
    vx: 0,
    vy: -SPEED,
    spin: 0,
  });
  const before = ball0(await h.snapshot());

  const bounce = await captureReplay(h, "bounce", async () => {
    const reflected = await h.until((s) => ball0(s).vy > 0, {
      maxFrames: 120,
      poll: 1,
    });
    await h.advance(RETURN_TICKS);
    return reflected;
  });

  expect(bounce.hit).toBe(true);
  const ball = ball0(bounce.snapshot);
  expect(ball.vy).toBeCloseTo(-before.vy, 6);
  expect(ball.vx).toBeCloseTo(before.vx, 6);
  expect(ball.speed).toBeCloseTo(before.speed, 6);
  expect(ball.spin).toBeCloseTo(0, 6);
  expect(ball.y).toBeGreaterThanOrEqual(PLACED - 1e-6);
  expect(ball.y).toBeLessThanOrEqual(PLACED + FRAME_TRAVEL);
});
