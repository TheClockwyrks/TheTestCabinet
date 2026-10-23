// The AI's brief (specs/modes/single-player.md): slower than the human, a
// short reaction delay, a small deadzone, and a drift home when the ball goes
// away.
//
// `aiVelocity` answers with the velocity the AI asks its paddle for; in the
// game the paddle pawn integrates that request through `integratePaddle`, so
// the checks below compose the two exactly as `AiPaddleController` does.

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
import { aiVelocity, type AiFaculties } from "./ai";
import { integratePaddle, type BallSim, type PaddleSim } from "./sim";

const FRAME = 1 / 60;

function ball(patch: Partial<BallSim> = {}): BallSim {
  return { x: 800, y: 360, vx: 300, vy: 0, spin: 0, ...patch };
}

/** Both faculties on, which is how the AI plays until something gates one. */
const WHOLE: AiFaculties = { tracking: true, movement: true };

/** One frame of the AI playing: compute the drive, then integrate it. */
function drive(
  paddle: PaddleSim,
  b: BallSim | null,
  active: boolean,
  faculties: AiFaculties = WHOLE,
): PaddleSim {
  return integratePaddle(
    { cy: paddle.cy, vy: aiVelocity(paddle.cy, b, active, FRAME, faculties) },
    FRAME,
  );
}

/** The paddle after `frames` frames of the AI playing against one fixed ball. */
function play(
  paddle: PaddleSim,
  b: BallSim | null,
  active: boolean,
  frames: number,
  each?: (paddle: PaddleSim) => void,
  faculties: AiFaculties = WHOLE,
): PaddleSim {
  let current = paddle;
  for (let i = 0; i < frames; i++) {
    current = drive(current, b, active, faculties);
    each?.(current);
  }
  return current;
}

it("is slower than the human paddle", () => {
  expect(AI_SPEED).toBeLessThan(PADDLE_SPEED);
});

it("tracks a ball coming toward it", () => {
  const paddle = drive({ cy: 360, vy: 0 }, ball({ y: 200 }), true);
  expect(paddle.vy).toBe(-AI_SPEED);
  expect(paddle.cy).toBeCloseTo(360 - AI_SPEED * FRAME, 9);
});

it("never moves faster than AI_SPEED", () => {
  play({ cy: 360, vy: 0 }, ball({ y: 660 }), true, 200, (paddle) => {
    expect(Math.abs(paddle.vy)).toBeLessThanOrEqual(AI_SPEED);
  });
});

it("aims where the ball was AI_REACT seconds ago, not where it is", () => {
  // The ball sits at 200 but is diving; the lagged perception is above it, so
  // the paddle chases upward for a moment even as the ball travels down.
  const lagging = drive({ cy: 128, vy: 0 }, ball({ y: 200, vy: 600 }), true);
  expect(lagging.cy).toBe(128); // 200 - 600 * 0.12 === 128: dead on the lag
  expect(AI_REACT).toBeGreaterThan(0);

  const chasing = drive({ cy: 200, vy: 0 }, ball({ y: 200, vy: 600 }), true);
  expect(chasing.cy).toBeLessThan(200);
});

it("stops inside the deadzone rather than jittering onto a perfect line", () => {
  const paddle = drive(
    { cy: 200 + AI_DEADZONE, vy: -1 },
    ball({ y: 200 }),
    true,
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

// ---- The two faculties (specs/state.md, specs/instrumentation.md) ---------

it("senses no ball with tracking off, and eases home instead", () => {
  const blind: AiFaculties = { tracking: false, movement: true };
  // The same incoming ball the tracking check above is caught by.
  const paddle = drive({ cy: 360, vy: 0 }, ball({ y: 200 }), true, blind);
  expect(paddle.vy).toBe(0); // already home, and home is where it aims
  expect(paddle.cy).toBe(360);

  // Posed away from home it travels there rather than toward the ball, and
  // stops inside the WIDER home deadzone.
  const settled = play(
    { cy: 600, vy: 0 },
    ball({ y: 660 }),
    true,
    120,
    undefined,
    blind,
  );
  expect(Math.abs(settled.cy - AI_HOME_Y)).toBeLessThanOrEqual(
    AI_HOME_DEADZONE,
  );
});

it("stays exactly where it is with movement off", () => {
  const still: AiFaculties = { tracking: true, movement: false };
  const paddle = play(
    { cy: 600, vy: 0 },
    ball({ y: 200 }),
    true,
    120,
    (frame) => {
      expect(frame.vy).toBe(0);
    },
    still,
  );
  expect(paddle.cy).toBe(600);
});

it("eases home when there is no ball on the field at all", () => {
  const paddle = play({ cy: 600, vy: 0 }, null, true, 120);
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  expect(paddle.vy).toBe(0);
});
