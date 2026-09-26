// The AI's brief (specs/modes/single-player.md): slower than the human, a short
// reaction delay, a small deadzone, and a drift home when the ball goes away —
// and, on top of that, its two faculties, which `specs/state.md` declares and the
// debug surface gates one at a time.

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
import type { AiState, BallState, PaddleState } from "./game";

const FRAME = 1 / 60;

/** Both faculties, as the title screen and `reset` leave them. */
const WHOLE: AiState = { tracking: true, movement: true };

function ball(patch: Partial<BallState> = {}): BallState {
  return {
    index: 0,
    x: 800,
    y: 360,
    vx: 300,
    vy: 0,
    spin: 0,
    held: false,
    holdTimer: 0,
    launchAngle: 0,
    trail: [],
    ...patch,
  };
}

function paddle(cy: number, vy = 0): PaddleState {
  return { cy, vy, driven: false, drivenVy: 0 };
}

it("is slower than the human paddle", () => {
  expect(AI_SPEED).toBeLessThan(PADDLE_SPEED);
});

it("tracks a ball coming toward it", () => {
  const p = paddle(360);
  updateAi(p, ball({ y: 200 }), true, WHOLE, FRAME);
  expect(p.vy).toBe(-AI_SPEED);
  expect(p.cy).toBeCloseTo(360 - AI_SPEED * FRAME, 9);
});

it("never moves faster than AI_SPEED", () => {
  const p = paddle(360);
  for (let i = 0; i < 200; i++) {
    updateAi(p, ball({ y: 660 }), true, WHOLE, FRAME);
    expect(Math.abs(p.vy)).toBeLessThanOrEqual(AI_SPEED);
  }
});

it("aims where the ball was AI_REACT seconds ago, not where it is", () => {
  // The ball sits at 200 but is diving; the lagged perception is above it, so the
  // paddle chases upward for a moment even as the ball travels down.
  const lagging = paddle(128);
  updateAi(lagging, ball({ y: 200, vy: 600 }), true, WHOLE, FRAME);
  expect(lagging.cy).toBe(128); // 200 - 600 * 0.12 === 128: dead on the lag
  expect(AI_REACT).toBeGreaterThan(0);

  const chasing = paddle(200);
  updateAi(chasing, ball({ y: 200, vy: 600 }), true, WHOLE, FRAME);
  expect(chasing.cy).toBeLessThan(200);
});

it("stops inside the deadzone rather than jittering onto a perfect line", () => {
  const p = paddle(200 + AI_DEADZONE, -1);
  updateAi(p, ball({ y: 200 }), true, WHOLE, FRAME);
  expect(p.vy).toBe(0);
  expect(p.cy).toBe(200 + AI_DEADZONE);
});

it("eases back toward the center with no ball to defend", () => {
  // `threatBall` hands the AI only a ball flying at its goal, so a ball that has
  // gone the other way reaches it as no defended ball at all.
  const p = paddle(600);
  for (let i = 0; i < 120; i++) {
    updateAi(p, null, true, WHOLE, FRAME);
  }
  expect(Math.abs(p.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  expect(p.vy).toBe(0);
});

it("stops within AI_HOME_DEADZONE of home and no closer", () => {
  const p = paddle(AI_HOME_Y + AI_HOME_DEADZONE);
  updateAi(p, null, true, WHOLE, FRAME);
  expect(p.vy).toBe(0);
  expect(p.cy).toBe(AI_HOME_Y + AI_HOME_DEADZONE);

  const outside = paddle(AI_HOME_Y + AI_HOME_DEADZONE + 1);
  updateAi(outside, null, true, WHOLE, FRAME);
  expect(outside.vy).toBeLessThan(0);
});

it("eases home while the balls are waiting on their home points", () => {
  const p = paddle(600);
  for (let i = 0; i < 120; i++) {
    updateAi(p, ball({ y: 660 }), false, WHOLE, FRAME);
  }
  expect(Math.abs(p.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("eases home when no ball is threatening its goal at all", () => {
  const p = paddle(600);
  for (let i = 0; i < 120; i++) updateAi(p, null, true, WHOLE, FRAME);
  expect(Math.abs(p.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("keeps its paddle fully on the field", () => {
  const high = paddle(100);
  for (let i = 0; i < 120; i++) {
    updateAi(high, ball({ y: -400 }), true, WHOLE, FRAME);
  }
  expect(high.cy).toBe(PADDLE_MIN_CY);

  const low = paddle(600);
  for (let i = 0; i < 120; i++) {
    updateAi(low, ball({ y: 1200 }), true, WHOLE, FRAME);
  }
  expect(low.cy).toBe(PADDLE_MAX_CY);
});

it("targets home, not the ball, with tracking off", () => {
  // Both paddles start ON home with a ball closing high above them. The sensing
  // AI chases it upward; the blind one is already at its target and stands still.
  const blind = paddle(AI_HOME_Y);
  const seeing = paddle(AI_HOME_Y);
  const incoming = ball({ y: 120 });
  updateAi(blind, incoming, true, { tracking: false, movement: true }, FRAME);
  updateAi(seeing, incoming, true, WHOLE, FRAME);

  expect(blind.vy).toBe(0);
  expect(blind.cy).toBe(AI_HOME_Y);
  expect(seeing.vy).toBeLessThan(0); // upward, toward the ball
});

it("keeps the home deadzone with tracking off", () => {
  // Inside AI_HOME_DEADZONE of home but well outside AI_DEADZONE of the ball: a
  // blind AI is already home and stands still.
  const p = paddle(AI_HOME_Y + AI_HOME_DEADZONE - 1);
  updateAi(
    p,
    ball({ y: 100 }),
    true,
    { tracking: false, movement: true },
    FRAME,
  );
  expect(p.vy).toBe(0);
});

it("stands still with movement off, wherever the ball is", () => {
  const p = paddle(600, -123);
  updateAi(
    p,
    ball({ y: 120 }),
    true,
    { tracking: true, movement: false },
    FRAME,
  );
  expect(p.cy).toBe(600);
  expect(p.vy).toBe(0);
});

it("gates the two faculties independently", () => {
  const still = paddle(600);
  updateAi(
    still,
    ball({ y: 120 }),
    true,
    { tracking: false, movement: false },
    FRAME,
  );
  expect(still.cy).toBe(600);
  expect(still.vy).toBe(0);
});
