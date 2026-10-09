// The AI's brief (specs/modes/single-player.md): slower than the human, a
// short reaction delay, a small deadzone, a drift home when nothing threatens
// its goal — and, with three balls in play, exactly one defended at a time:
// the one arriving soonest.
//
// `aiVelocity` answers with the velocity the AI asks its paddle for; in the
// game the paddle pawn integrates that request through `integratePaddle`, so
// the checks below compose the two exactly as `AiPaddleController` does.

import { describe, expect, it } from "vitest";
import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
  P2_X0,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  PADDLE_SPEED,
} from "./constants";
import { aiVelocity, threatBall } from "./ai";
import {
  integratePaddle,
  type BallSim,
  type PaddleSim,
  type RallyBall,
} from "./sim";

const FRAME = 1 / 60;

function ball(patch: Partial<BallSim> = {}): BallSim {
  return { x: 800, y: 360, vx: 300, vy: 0, spin: 0, ...patch };
}

function rallyBall(patch: Partial<RallyBall> = {}): RallyBall {
  return { ...ball(), held: false, ...patch };
}

/** One frame of the AI playing: compute the drive, then integrate it. */
function drive(
  paddle: PaddleSim,
  b: BallSim | null,
  active: boolean,
): PaddleSim {
  return integratePaddle(
    { cy: paddle.cy, vy: aiVelocity(paddle.cy, b, active, FRAME) },
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
): PaddleSim {
  let current = paddle;
  for (let i = 0; i < frames; i++) {
    current = drive(current, b, active);
    each?.(current);
  }
  return current;
}

describe("aiVelocity", () => {
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
    // The ball sits at 200 but is diving; the lagged perception is above it,
    // so the paddle chases upward for a moment even as the ball travels down.
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

  it("eases back toward the center with no ball to defend", () => {
    const paddle = play({ cy: 600, vy: 0 }, null, true, 120);
    expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(
      AI_HOME_DEADZONE,
    );
    expect(paddle.vy).toBe(0);
  });

  it("eases home during the opening countdown too", () => {
    const paddle = play({ cy: 600, vy: 0 }, ball({ y: 660 }), false, 120);
    expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(
      AI_HOME_DEADZONE,
    );
  });

  it("keeps its paddle fully on the field", () => {
    const high = play({ cy: 100, vy: 0 }, ball({ y: -400 }), true, 120);
    expect(high.cy).toBe(PADDLE_MIN_CY);

    const low = play({ cy: 600, vy: 0 }, ball({ y: 1200 }), true, 120);
    expect(low.cy).toBe(PADDLE_MAX_CY);
  });
});

describe("threatBall", () => {
  it("picks the ball arriving at its goal soonest", () => {
    const near = rallyBall({ x: 1000, y: 100, vx: 300 });
    const far = rallyBall({ x: 200, y: 600, vx: 300 });
    expect(threatBall([far, near])).toBe(near);
  });

  it("weighs arrival time, not distance", () => {
    // The far ball is twice as far but four times as fast, so it lands first.
    const slowNear = rallyBall({ x: P2_X0 - 200, vx: 100 });
    const fastFar = rallyBall({ x: P2_X0 - 400, vx: 400 });
    expect(threatBall([slowNear, fastFar])).toBe(fastFar);
  });

  it("ignores balls moving away, waiting, or already past the paddle", () => {
    const away = rallyBall({ vx: -300 });
    const waiting = rallyBall({ vx: 300, held: true });
    const behind = rallyBall({ x: P2_X0 + 10, vx: 300 });
    expect(threatBall([away, waiting, behind])).toBeNull();
  });

  it("finds nothing in an empty rally", () => {
    expect(threatBall([])).toBeNull();
  });
});
