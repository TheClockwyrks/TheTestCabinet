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
import { createBall, createPaddle } from "./entities";
import type { AiState, BallState, PaddleState } from "./game";

const FRAME = 1 / 60;

/** Both faculties on, which is how the AI starts and what `reset` restores. */
function faculties(patch: Partial<AiState> = {}): AiState {
  return { tracking: true, movement: true, ...patch };
}

function ball(patch: Partial<BallState> = {}): BallState {
  return { ...createBall(), x: 800, y: 360, vx: 300, vy: 0, ...patch };
}

/** A paddle at `cy`, under nobody's control. */
function paddleAt(cy: number, vy = 0): PaddleState {
  return { ...createPaddle(), cy, vy };
}

it("is slower than the human paddle", () => {
  expect(AI_SPEED).toBeLessThan(PADDLE_SPEED);
});

it("tracks a ball coming toward it", () => {
  const paddle = paddleAt(360, 0);
  updateAi(paddle, ball({ y: 200 }), faculties(), true, FRAME);
  expect(paddle.vy).toBe(-AI_SPEED);
  expect(paddle.cy).toBeCloseTo(360 - AI_SPEED * FRAME, 9);
});

it("never moves faster than AI_SPEED", () => {
  const paddle = paddleAt(360, 0);
  for (let i = 0; i < 200; i++) {
    updateAi(paddle, ball({ y: 660 }), faculties(), true, FRAME);
    expect(Math.abs(paddle.vy)).toBeLessThanOrEqual(AI_SPEED);
  }
});

it("aims where the ball was AI_REACT seconds ago, not where it is", () => {
  // The ball sits at 200 but is diving; the lagged perception is above it, so the
  // paddle chases upward for a moment even as the ball travels down.
  const lagging = paddleAt(128, 0);
  updateAi(lagging, ball({ y: 200, vy: 600 }), faculties(), true, FRAME);
  expect(lagging.cy).toBe(128); // 200 - 600 * 0.12 === 128: dead on the lag
  expect(AI_REACT).toBeGreaterThan(0);

  const chasing = paddleAt(200, 0);
  updateAi(chasing, ball({ y: 200, vy: 600 }), faculties(), true, FRAME);
  expect(chasing.cy).toBeLessThan(200);
});

it("stops inside the deadzone rather than jittering onto a perfect line", () => {
  const paddle = paddleAt(200 + AI_DEADZONE, -1);
  updateAi(paddle, ball({ y: 200 }), faculties(), true, FRAME);
  expect(paddle.vy).toBe(0);
  expect(paddle.cy).toBe(200 + AI_DEADZONE);
});

it("returns toward the center while the ball travels away, and stops within AI_HOME_DEADZONE", () => {
  const paddle = paddleAt(600, 0);
  for (let i = 0; i < 120; i++) {
    updateAi(paddle, ball({ y: 660, vx: -300 }), faculties(), true, FRAME);
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  expect(paddle.vy).toBe(0);
});

it("holds still just inside the home deadzone and moves just outside it", () => {
  const inside = paddleAt(AI_HOME_Y + AI_HOME_DEADZONE, 0);
  updateAi(inside, ball({ vx: -300 }), faculties(), true, FRAME);
  expect(inside.vy).toBe(0);
  expect(inside.cy).toBe(AI_HOME_Y + AI_HOME_DEADZONE);

  const outside = paddleAt(AI_HOME_Y + AI_HOME_DEADZONE + 1, 0);
  updateAi(outside, ball({ vx: -300 }), faculties(), true, FRAME);
  expect(outside.vy).toBeLessThan(0);
});

it("returns home during the pre-serve hold too", () => {
  const paddle = paddleAt(600, 0);
  for (let i = 0; i < 120; i++) {
    updateAi(paddle, ball({ y: 660, vx: 0 }), faculties(), false, FRAME);
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("keeps its paddle fully on the field", () => {
  const high = paddleAt(100, 0);
  for (let i = 0; i < 120; i++)
    updateAi(high, ball({ y: -400 }), faculties(), true, FRAME);
  expect(high.cy).toBe(PADDLE_MIN_CY);

  const low = paddleAt(600, 0);
  for (let i = 0; i < 120; i++)
    updateAi(low, ball({ y: 1200 }), faculties(), true, FRAME);
  expect(low.cy).toBe(PADDLE_MAX_CY);
});

// ---- The two faculties (specs/instrumentation.md) -------------------------

it("targets home rather than the ball while it is not tracking", () => {
  const blind = paddleAt(AI_HOME_Y, 0);
  updateAi(
    blind,
    ball({ y: 660 }),
    faculties({ tracking: false }),
    true,
    FRAME,
  );
  expect(blind.vy).toBe(0);
  expect(blind.cy).toBe(AI_HOME_Y);

  // The same frame with the faculty on chases the ball instead.
  const seeing = paddleAt(AI_HOME_Y, 0);
  updateAi(seeing, ball({ y: 660 }), faculties(), true, FRAME);
  expect(seeing.vy).toBe(AI_SPEED);
});

it("drifts home from off-center while it is not tracking", () => {
  const paddle = paddleAt(600, 0);
  for (let i = 0; i < 120; i++) {
    updateAi(
      paddle,
      ball({ y: 660 }),
      faculties({ tracking: false }),
      true,
      FRAME,
    );
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("leaves the paddle exactly where it is while it is not moving", () => {
  const paddle = paddleAt(200, -400);
  updateAi(
    paddle,
    ball({ y: 660 }),
    faculties({ movement: false }),
    true,
    FRAME,
  );
  expect(paddle.cy).toBe(200);
  expect(paddle.vy).toBe(0);
});

it("returns home when there is no ball on the field at all", () => {
  const paddle = paddleAt(600, 0);
  for (let i = 0; i < 120; i++) {
    updateAi(paddle, null, faculties(), true, FRAME);
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});
