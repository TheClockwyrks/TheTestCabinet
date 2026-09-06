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
import { aiPaddle, aiTarget } from "./ai";
import type { AiState, BallState, PaddleState } from "./game";

const FRAME = 1 / 60;

/** Both faculties on, which is how a match is played and what `reset` restores. */
const AWAKE: AiState = { tracking: true, movement: true };

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

function paddle(cy: number, vy = 0): PaddleState {
  return { cy, vy, driven: false, drivenVy: 0 };
}

/** One frame of the AI with both faculties on. */
function updateAi(
  p: PaddleState,
  b: BallState | null,
  live: boolean,
  dt: number,
): PaddleState {
  return aiPaddle(p, b, AWAKE, live, dt);
}

/** The paddle after `frames` frames of the AI playing against one fixed ball. */
function play(
  start: PaddleState,
  b: BallState,
  active: boolean,
  frames: number,
  each?: (paddle: PaddleState) => void,
): PaddleState {
  let current = start;
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
  const tracked = updateAi(paddle(360), ball({ y: 200 }), true, FRAME);
  expect(tracked.vy).toBe(-AI_SPEED);
  expect(tracked.cy).toBeCloseTo(360 - AI_SPEED * FRAME, 9);
});

it("never moves faster than AI_SPEED", () => {
  play(paddle(360), ball({ y: 660 }), true, 200, (paddle) => {
    expect(Math.abs(paddle.vy)).toBeLessThanOrEqual(AI_SPEED);
  });
});

it("aims where the ball was AI_REACT seconds ago, not where it is", () => {
  // The ball sits at 200 but is diving; the lagged perception is above it, so the
  // paddle chases upward for a moment even as the ball travels down.
  const lagging = updateAi(paddle(128), ball({ y: 200, vy: 600 }), true, FRAME);
  expect(lagging.cy).toBe(128); // 200 - 600 * 0.12 === 128: dead on the lag
  expect(AI_REACT).toBeGreaterThan(0);

  const chasing = updateAi(paddle(200), ball({ y: 200, vy: 600 }), true, FRAME);
  expect(chasing.cy).toBeLessThan(200);
});

it("stops inside the deadzone rather than jittering onto a perfect line", () => {
  const settled = updateAi(
    paddle(200 + AI_DEADZONE, -1),
    ball({ y: 200 }),
    true,
    FRAME,
  );
  expect(settled.vy).toBe(0);
  expect(settled.cy).toBe(200 + AI_DEADZONE);
});

it("eases back toward the center while the ball travels away", () => {
  const homed = play(paddle(600), ball({ y: 660, vx: -300 }), true, 120);
  expect(Math.abs(homed.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  expect(homed.vy).toBe(0);
});

it("eases home during the pre-serve hold too", () => {
  const homed = play(paddle(600), ball({ y: 660, vx: 0 }), false, 120);
  expect(Math.abs(homed.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("keeps its paddle fully on the field", () => {
  const high = play(paddle(100), ball({ y: -400 }), true, 120);
  expect(high.cy).toBe(PADDLE_MIN_CY);

  const low = play(paddle(600), ball({ y: 1200 }), true, 120);
  expect(low.cy).toBe(PADDLE_MAX_CY);
});

it("leaves the paddle it was given alone", () => {
  const before: PaddleState = paddle(360);
  updateAi(before, ball({ y: 200 }), true, FRAME);
  expect(before).toEqual(paddle(360));
});

// ---- The two faculties (specs/instrumentation.md) ------------------------

it("senses nothing and holds station at home with tracking off", () => {
  const blind: AiState = { tracking: false, movement: true };
  const incoming = ball({ y: 120, vx: 300 });
  // Tracking on, the paddle chases the ball up; tracking off, it is already home
  // and stays there, whatever the ball is doing.
  expect(
    aiPaddle(paddle(AI_HOME_Y), incoming, AWAKE, true, FRAME).cy,
  ).toBeLessThan(AI_HOME_Y);
  const held = aiPaddle(paddle(AI_HOME_Y), incoming, blind, true, FRAME);
  expect(held.cy).toBe(AI_HOME_Y);
  expect(held.vy).toBe(0);
  expect(aiTarget(incoming, blind, true)).toEqual({
    target: AI_HOME_Y,
    deadzone: AI_HOME_DEADZONE,
  });
});

it("leaves its paddle where it is, at zero velocity, with movement off", () => {
  const still: AiState = { tracking: true, movement: false };
  const after = aiPaddle(
    paddle(600, 400),
    ball({ y: 120 }),
    still,
    true,
    FRAME,
  );
  expect(after.cy).toBe(600);
  expect(after.vy).toBe(0);
});

it("has nothing to track while the ball is absent", () => {
  const homing = play2(paddle(600), null, 120);
  expect(Math.abs(homing.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

/** The paddle after `frames` live frames against a ball that may be absent. */
function play2(
  start: PaddleState,
  b: BallState | null,
  frames: number,
): PaddleState {
  let current = start;
  for (let i = 0; i < frames; i++) {
    current = aiPaddle(current, b, AWAKE, true, FRAME);
  }
  return current;
}
