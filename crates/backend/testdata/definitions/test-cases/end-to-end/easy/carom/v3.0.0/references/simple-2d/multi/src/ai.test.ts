// The AI's brief (specs/modes/single-player.md): slower than the human, a short
// reaction delay, a small deadzone, and a drift home when nothing threatens its
// goal. `updateAi` returns the paddle after the frame, so a run of frames is a
// fold.
//
// Its two faculties (specs/instrumentation.md) are arguments here rather than
// hidden switches: `tracking` decides whether it senses the ball at all, and
// `movement` decides whether the paddle travels.

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

/** Both faculties on, which is how a match is played and how `reset` leaves it. */
const AWAKE: AiState = { tracking: true, movement: true };

function paddle(patch: Partial<PaddleState> = {}): PaddleState {
  return { cy: 360, vy: 0, driven: false, drivenVy: 0, ...patch };
}

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

/** The paddle after `count` frames against the same ball. */
function run(
  start: PaddleState,
  target: BallState | null,
  live: boolean,
  count: number,
  ai: AiState = AWAKE,
): PaddleState {
  let current = start;
  for (let i = 0; i < count; i++) {
    current = updateAi(current, target, ai, live, FRAME);
  }
  return current;
}

it("is slower than the human paddle", () => {
  expect(AI_SPEED).toBeLessThan(PADDLE_SPEED);
});

it("tracks a ball coming toward it", () => {
  const moved = updateAi(paddle(), ball({ y: 200 }), AWAKE, true, FRAME);
  expect(moved.vy).toBe(-AI_SPEED);
  expect(moved.cy).toBeCloseTo(360 - AI_SPEED * FRAME, 9);
});

it("returns a new paddle and leaves the one it was handed alone", () => {
  const before = paddle();
  const after = updateAi(before, ball({ y: 200 }), AWAKE, true, FRAME);
  expect(before).toEqual(paddle());
  expect(after).not.toBe(before);
});

it("carries the driven flag and drivenVy through untouched", () => {
  const before = paddle({ driven: false, drivenVy: 240 });
  const after = updateAi(before, ball({ y: 200 }), AWAKE, true, FRAME);
  expect(after.driven).toBe(false);
  expect(after.drivenVy).toBe(240);
});

it("never moves faster than AI_SPEED", () => {
  let current = paddle();
  for (let i = 0; i < 200; i++) {
    current = updateAi(current, ball({ y: 660 }), AWAKE, true, FRAME);
    expect(Math.abs(current.vy)).toBeLessThanOrEqual(AI_SPEED);
  }
});

it("aims where the ball was AI_REACT seconds ago, not where it is", () => {
  // The ball sits at 200 but is diving; the lagged perception is above it, so the
  // paddle chases upward for a moment even as the ball travels down.
  const lagging = updateAi(
    paddle({ cy: 128 }),
    ball({ y: 200, vy: 600 }),
    AWAKE,
    true,
    FRAME,
  );
  expect(lagging.cy).toBe(128); // 200 - 600 * 0.12 === 128: dead on the lag
  expect(AI_REACT).toBeGreaterThan(0);

  const chasing = updateAi(
    paddle({ cy: 200 }),
    ball({ y: 200, vy: 600 }),
    AWAKE,
    true,
    FRAME,
  );
  expect(chasing.cy).toBeLessThan(200);
});

it("stops inside the deadzone rather than jittering onto a perfect line", () => {
  const stopped = updateAi(
    paddle({ cy: 200 + AI_DEADZONE, vy: -1 }),
    ball({ y: 200 }),
    AWAKE,
    true,
    FRAME,
  );
  expect(stopped.vy).toBe(0);
  expect(stopped.cy).toBe(200 + AI_DEADZONE);
});

it("eases back toward the center while nothing threatens its goal", () => {
  const home = run(paddle({ cy: 600 }), null, true, 120);
  expect(Math.abs(home.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("eases home while the balls are waiting on their home points", () => {
  const home = run(paddle({ cy: 600 }), ball({ y: 660 }), false, 120);
  expect(Math.abs(home.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("keeps its paddle fully on the field", () => {
  const high = run(paddle({ cy: 100 }), ball({ y: -400 }), true, 120);
  expect(high.cy).toBe(PADDLE_MIN_CY);

  const low = run(paddle({ cy: 600 }), ball({ y: 1200 }), true, 120);
  expect(low.cy).toBe(PADDLE_MAX_CY);
});

// ---- The two faculties --------------------------------------------------

it("senses nothing with tracking off, and holds AI_HOME_Y instead", () => {
  const blind: AiState = { tracking: false, movement: true };
  // The ball is far above; a sensing AI would climb to meet it.
  const held = run(paddle({ cy: 600 }), ball({ y: 100 }), true, 120, blind);
  expect(Math.abs(held.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("uses the home deadzone with tracking off, whatever the ball is doing", () => {
  const blind: AiState = { tracking: false, movement: true };
  const inside = updateAi(
    paddle({ cy: AI_HOME_Y + AI_HOME_DEADZONE }),
    ball({ y: 100 }),
    blind,
    true,
    FRAME,
  );
  expect(inside.vy).toBe(0);
  expect(inside.cy).toBe(AI_HOME_Y + AI_HOME_DEADZONE);
});

it("leaves the paddle where it is with movement off, at a vy of 0", () => {
  const still: AiState = { tracking: true, movement: false };
  const parked = run(paddle({ cy: 600 }), ball({ y: 100 }), true, 120, still);
  expect(parked.cy).toBe(600);
  expect(parked.vy).toBe(0);
});

it("neither senses nor travels with both faculties off", () => {
  const off: AiState = { tracking: false, movement: false };
  const parked = updateAi(paddle({ cy: 600 }), ball(), off, true, FRAME);
  expect(parked.cy).toBe(600);
  expect(parked.vy).toBe(0);
});
