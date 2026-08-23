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
import type { BallState, PaddleState } from "./game";

const FRAME = 1 / 60;

function ball(patch: Partial<BallState> = {}): BallState {
  return { x: 800, y: 360, vx: 300, vy: 0, spin: 0, ...patch };
}

it("is slower than the human paddle", () => {
  expect(AI_SPEED).toBeLessThan(PADDLE_SPEED);
});

it("tracks a ball coming toward it", () => {
  const paddle: PaddleState = { cy: 360, vy: 0 };
  const next = updateAi(paddle, ball({ y: 200 }), true, FRAME);
  expect(next.vy).toBe(-AI_SPEED);
  expect(next.cy).toBeCloseTo(360 - AI_SPEED * FRAME, 9);
  // The paddle it was handed is as it was.
  expect(paddle).toEqual({ cy: 360, vy: 0 });
});

it("never moves faster than AI_SPEED", () => {
  let paddle: PaddleState = { cy: 360, vy: 0 };
  for (let i = 0; i < 200; i++) {
    paddle = updateAi(paddle, ball({ y: 660 }), true, FRAME);
    expect(Math.abs(paddle.vy)).toBeLessThanOrEqual(AI_SPEED);
  }
});

it("aims where the ball was AI_REACT seconds ago, not where it is", () => {
  // The ball sits at 200 but is diving; the lagged perception is above it, so the
  // paddle chases upward for a moment even as the ball travels down.
  const lagging = updateAi(
    { cy: 128, vy: 0 },
    ball({ y: 200, vy: 600 }),
    true,
    FRAME,
  );
  expect(lagging.cy).toBe(128); // 200 - 600 * 0.12 === 128: dead on the lag
  expect(AI_REACT).toBeGreaterThan(0);

  const chasing = updateAi(
    { cy: 200, vy: 0 },
    ball({ y: 200, vy: 600 }),
    true,
    FRAME,
  );
  expect(chasing.cy).toBeLessThan(200);
});

it("stops inside the deadzone rather than jittering onto a perfect line", () => {
  const next = updateAi(
    { cy: 200 + AI_DEADZONE, vy: -1 },
    ball({ y: 200 }),
    true,
    FRAME,
  );
  expect(next.vy).toBe(0);
  expect(next.cy).toBe(200 + AI_DEADZONE);
});

it("returns toward the center while the ball travels away", () => {
  let paddle = updateAi(
    { cy: 600, vy: 0 },
    ball({ y: 660, vx: -300 }),
    true,
    FRAME,
  );
  expect(paddle.vy).toBe(-AI_SPEED);
  for (let i = 0; i < 120; i++) {
    paddle = updateAi(paddle, ball({ y: 660, vx: -300 }), true, FRAME);
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  expect(paddle.vy).toBe(0);
});

it("stops within AI_HOME_DEADZONE of home, wider than the defending deadzone", () => {
  expect(AI_HOME_DEADZONE).toBeGreaterThan(AI_DEADZONE);
  const next = updateAi(
    { cy: AI_HOME_Y + AI_HOME_DEADZONE, vy: 0 },
    ball({ y: 660, vx: -300 }),
    true,
    FRAME,
  );
  expect(next.vy).toBe(0);
  expect(next.cy).toBe(AI_HOME_Y + AI_HOME_DEADZONE);
});

it("returns home during the pre-serve hold too", () => {
  let paddle: PaddleState = { cy: 600, vy: 0 };
  for (let i = 0; i < 120; i++) {
    paddle = updateAi(paddle, ball({ y: 660, vx: 0 }), false, FRAME);
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("keeps its paddle fully on the field", () => {
  let high: PaddleState = { cy: 100, vy: 0 };
  for (let i = 0; i < 120; i++) {
    high = updateAi(high, ball({ y: -400 }), true, FRAME);
  }
  expect(high.cy).toBe(PADDLE_MIN_CY);

  let low: PaddleState = { cy: 600, vy: 0 };
  for (let i = 0; i < 120; i++) {
    low = updateAi(low, ball({ y: 1200 }), true, FRAME);
  }
  expect(low.cy).toBe(PADDLE_MAX_CY);
});
