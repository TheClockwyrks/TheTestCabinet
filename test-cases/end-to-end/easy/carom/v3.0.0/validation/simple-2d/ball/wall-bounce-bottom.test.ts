// ball/wall-bounce-bottom — the ball reflects off the bottom wall.
//
// The ball is fired straight down the field's center line, clear of both
// obstacles and both paddles, into the bottom wall. specs/balls.md fixes the
// result exactly: if `y + BALL_R > FIELD_H` and `vy > 0`, then `y = FIELD_H - BALL_R` and `vy = -vy`. Speed is unchanged, so the bounce is a pure reflection.
//
// Placement is read at the end of the frame of the contact. The frame is cut
// into sub-steps, and a sub-step that follows the one that struck carries the
// ball back off the wall, so the center is read within one frame of travel of
// `FIELD_H - BALL_R`, on the field side of it.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_R, FIELD_CX, FIELD_H } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Where the center lands off the wall. */
const PLACED = FIELD_H - BALL_R;
/** The approach, in units per second; one frame of it bounds the placement. */
const SPEED = 500;
const FRAME_TRAVEL = SPEED / TICK_HZ;
/** Half a second of approach, so the clip opens on a ball in flight. */
const START_Y = FIELD_H - BALL_R - SPEED / 2;

/** Frames of the returning flight recorded after the reflection. */
const RETURN_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reflects the ball off the bottom wall", async () => {
  await arrangeLiveBall(h, { x: FIELD_CX, y: START_Y, vx: 0, vy: SPEED });
  const before = ball0(h.snapshot());

  const bounce = await captureReplay(h, "bounce", async () => {
    const reflected = await h.until((s) => ball0(s).vy < 0, {
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
  assertLessThanOrEqual(ball.y, PLACED + 1e-6);
  assertGreaterThanOrEqual(ball.y, PLACED - FRAME_TRAVEL);
});
