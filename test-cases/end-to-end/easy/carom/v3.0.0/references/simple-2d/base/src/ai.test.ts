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

/** The paddle after `frames` frames of the AI playing against one fixed ball. */
function play(
  paddle: PaddleState,
  b: BallState,
  active: boolean,
  frames: number,
  each?: (paddle: PaddleState) => void,
): PaddleState {
  let current = paddle;
  for (let i = 0; i < frames; i++) {
    current = updateAi(current, b, active, FRAME);
    each?.(current);
  }
  return current;
}

it("is slower than the human paddle", () => {
  expect(AI_SPEED).toBeLessThan(PADDLE_SPEED);
});

it("tracks a ball coming toward it", () => {
  const paddle = updateAi({ cy: 360, vy: 0 }, ball({ y: 200 }), true, FRAME);
  expect(paddle.vy).toBe(-AI_SPEED);
  expect(paddle.cy).toBeCloseTo(360 - AI_SPEED * FRAME, 9);
});

it("never moves faster than AI_SPEED", () => {
  play({ cy: 360, vy: 0 }, ball({ y: 660 }), true, 200, (paddle) => {
    expect(Math.abs(paddle.vy)).toBeLessThanOrEqual(AI_SPEED);
  });
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
  const paddle = updateAi(
    { cy: 200 + AI_DEADZONE, vy: -1 },
    ball({ y: 200 }),
    true,
    FRAME,
  );
  expect(paddle.vy).toBe(0);
  expect(paddle.cy).toBe(200 + AI_DEADZONE);
});

it("eases back toward the center while the ball travels away", () => {
  const paddle = play(
    { cy: 600, vy: 0 },
    ball({ y: 660, vx: -300 }),
    true,
    120,
  );
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  expect(paddle.vy).toBe(0);
});

it("eases home during the pre-serve hold too", () => {
  const paddle = play({ cy: 600, vy: 0 }, ball({ y: 660, vx: 0 }), false, 120);
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("keeps its paddle fully on the field", () => {
  const high = play({ cy: 100, vy: 0 }, ball({ y: -400 }), true, 120);
  expect(high.cy).toBe(PADDLE_MIN_CY);

  const low = play({ cy: 600, vy: 0 }, ball({ y: 1200 }), true, 120);
  expect(low.cy).toBe(PADDLE_MAX_CY);
});

it("leaves the paddle it was given alone", () => {
  const before: PaddleState = { cy: 360, vy: 0 };
  updateAi(before, ball({ y: 200 }), true, FRAME);
  expect(before).toEqual({ cy: 360, vy: 0 });
});
