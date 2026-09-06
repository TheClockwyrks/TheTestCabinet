// The AI's brief (specs/modes/single-player.md): slower than the human, a short
// reaction delay, a small deadzone, and a drift home when the ball goes away.

import { expect, it } from "vitest";
import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  PADDLE_SPEED,
} from "./constants";
import { updateAi } from "./ai";
import type { AiState, BallState, PaddleState } from "./state";

const FRAME = 1 / 60;

/** Both faculties, which is how the AI plays and what a reset restores. */
const WHOLE: AiState = { tracking: true, movement: true };

function ball(patch: Partial<BallState> = {}): BallState {
  return {
    x: 800,
    y: 360,
    vx: 300,
    vy: 0,
    spin: 0,
    held: false,
    holdTimer: 0,
    serveSign: 1,
    trail: [],
    ...patch,
  };
}

function paddleAt(cy: number, vy = 0): PaddleState {
  return { cy, vy, driven: false, drivenVy: 0 };
}

it("is slower than the human paddle", () => {
  expect(AI_SPEED).toBeLessThan(PADDLE_SPEED);
});

it("tracks a ball coming toward it", () => {
  const paddle = paddleAt(360, 0);
  updateAi(paddle, ball({ y: 200 }), WHOLE, true, FRAME);
  expect(paddle.vy).toBe(-AI_SPEED);
  expect(paddle.cy).toBeCloseTo(360 - AI_SPEED * FRAME, 9);
});

it("never moves faster than AI_SPEED", () => {
  const paddle = paddleAt(360, 0);
  for (let i = 0; i < 200; i++) {
    updateAi(paddle, ball({ y: 660 }), WHOLE, true, FRAME);
    expect(Math.abs(paddle.vy)).toBeLessThanOrEqual(AI_SPEED);
  }
});

it("aims where the ball was AI_REACT seconds ago, not where it is", () => {
  // The ball sits at 200 but is diving; the lagged perception is above it, so the
  // paddle chases upward for a moment even as the ball travels down.
  const lagging = paddleAt(128, 0);
  updateAi(lagging, ball({ y: 200, vy: 600 }), WHOLE, true, FRAME);
  expect(lagging.cy).toBe(128); // 200 - 600 * 0.12 === 128: dead on the lag
  expect(AI_REACT).toBeGreaterThan(0);

  const chasing = paddleAt(200, 0);
  updateAi(chasing, ball({ y: 200, vy: 600 }), WHOLE, true, FRAME);
  expect(chasing.cy).toBeLessThan(200);
});

it("stops inside the deadzone rather than jittering onto a perfect line", () => {
  const paddle = paddleAt(200 + AI_DEADZONE, -1);
  updateAi(paddle, ball({ y: 200 }), WHOLE, true, FRAME);
  expect(paddle.vy).toBe(0);
  expect(paddle.cy).toBe(200 + AI_DEADZONE);
});

it("returns home while the ball travels away, stopping inside AI_HOME_DEADZONE", () => {
  const paddle = paddleAt(600, 0);
  updateAi(paddle, ball({ y: 660, vx: -300 }), WHOLE, true, FRAME);
  expect(paddle.vy).toBe(-AI_SPEED);
  for (let i = 0; i < 120; i++) {
    updateAi(paddle, ball({ y: 660, vx: -300 }), WHOLE, true, FRAME);
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  expect(paddle.vy).toBe(0);
});

it("holds still at home once inside AI_HOME_DEADZONE", () => {
  const paddle = paddleAt(AI_HOME_Y + AI_HOME_DEADZONE, -1);
  updateAi(paddle, ball({ y: 660, vx: -300 }), WHOLE, true, FRAME);
  expect(paddle.vy).toBe(0);
  expect(paddle.cy).toBe(AI_HOME_Y + AI_HOME_DEADZONE);
});

it("returns home during the pre-serve hold too", () => {
  const paddle = paddleAt(600, 0);
  for (let i = 0; i < 120; i++) {
    updateAi(paddle, ball({ y: 660, vx: 0 }), WHOLE, false, FRAME);
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("keeps its paddle fully on the field", () => {
  const high = paddleAt(100, 0);
  for (let i = 0; i < 120; i++)
    updateAi(high, ball({ y: -400 }), WHOLE, true, FRAME);
  expect(high.cy).toBe(PADDLE_MIN_CY);

  const low = paddleAt(600, 0);
  for (let i = 0; i < 120; i++)
    updateAi(low, ball({ y: 1200 }), WHOLE, true, FRAME);
  expect(low.cy).toBe(PADDLE_MAX_CY);
});

// ---- The two faculties (specs/instrumentation.md) ------------------------

it("leaves its paddle where it is, at rest, without movement", () => {
  const paddle = paddleAt(600, -400);
  updateAi(
    paddle,
    ball({ y: 100 }),
    { tracking: true, movement: false },
    true,
    FRAME,
  );
  expect(paddle.cy).toBe(600);
  expect(paddle.vy).toBe(0);
});

it("targets home, whatever the ball is doing, without tracking", () => {
  // The ball is diving toward it, and a tracking opponent would chase; this one
  // eases back to the vertical center instead.
  const paddle = paddleAt(600);
  updateAi(
    paddle,
    ball({ y: 660 }),
    { tracking: false, movement: true },
    true,
    FRAME,
  );
  expect(paddle.vy).toBe(-AI_SPEED);
  for (let i = 0; i < 120; i++) {
    updateAi(
      paddle,
      ball({ y: 660 }),
      { tracking: false, movement: true },
      true,
      FRAME,
    );
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("eases home with no ball on the field at all", () => {
  const paddle = paddleAt(600);
  for (let i = 0; i < 120; i++) updateAi(paddle, null, WHOLE, true, FRAME);
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});
