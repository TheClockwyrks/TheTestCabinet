// The AI's brief (specs/modes/single-player.md): slower than the human, a short
// reaction delay, a small deadzone, and a drift home when the ball goes away —
// plus the two faculties specs/instrumentation.md gates separately, which is what
// lets a check separate "it never saw the ball" from "it saw it and stood still".

import { describe, expect, it } from "vitest";
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
import { aiTarget, updateAi } from "./ai";
import { parkedBall, type PaddleMotion } from "./entities";
import type { AiState, BallState } from "./game";

const FRAME = 1 / 60;

/** Both faculties on, which is where a fresh title screen and `reset` leave them. */
const ABLE: AiState = { tracking: true, movement: true };

function ball(patch: Partial<BallState> = {}): BallState {
  return {
    ...parkedBall(),
    x: 800,
    vx: 300,
    held: false,
    holdTimer: 0,
    ...patch,
  };
}

/** The AI's paddle after one frame of live play against `b`. */
function defend(
  paddle: PaddleMotion,
  b: BallState | null,
  ai: AiState = ABLE,
): PaddleMotion {
  return updateAi(paddle, ai, b, true, FRAME);
}

it("is slower than the human paddle", () => {
  expect(AI_SPEED).toBeLessThan(PADDLE_SPEED);
});

it("tracks a ball coming toward it", () => {
  const paddle: PaddleMotion = { cy: 360, vy: 0 };
  const next = defend(paddle, ball({ y: 200 }));
  expect(next.vy).toBe(-AI_SPEED);
  expect(next.cy).toBeCloseTo(360 - AI_SPEED * FRAME, 9);
  // The paddle it was handed is as it was.
  expect(paddle).toEqual({ cy: 360, vy: 0 });
});

it("never moves faster than AI_SPEED", () => {
  let paddle: PaddleMotion = { cy: 360, vy: 0 };
  for (let i = 0; i < 200; i++) {
    paddle = defend(paddle, ball({ y: 660 }));
    expect(Math.abs(paddle.vy)).toBeLessThanOrEqual(AI_SPEED);
  }
});

it("aims where the ball was AI_REACT seconds ago, not where it is", () => {
  // The ball sits at 200 but is diving; the lagged perception is above it, so the
  // paddle chases upward for a moment even as the ball travels down.
  const lagging = defend({ cy: 128, vy: 0 }, ball({ y: 200, vy: 600 }));
  expect(lagging.cy).toBe(128); // 200 - 600 * 0.12 === 128: dead on the lag
  expect(AI_REACT).toBeGreaterThan(0);

  const chasing = defend({ cy: 200, vy: 0 }, ball({ y: 200, vy: 600 }));
  expect(chasing.cy).toBeLessThan(200);
});

it("stops inside the deadzone rather than jittering onto a perfect line", () => {
  const next = defend({ cy: 200 + AI_DEADZONE, vy: -1 }, ball({ y: 200 }));
  expect(next.vy).toBe(0);
  expect(next.cy).toBe(200 + AI_DEADZONE);
});

it("returns toward the center while the ball travels away", () => {
  let paddle = defend({ cy: 600, vy: 0 }, ball({ y: 660, vx: -300 }));
  expect(paddle.vy).toBe(-AI_SPEED);
  for (let i = 0; i < 120; i++) {
    paddle = defend(paddle, ball({ y: 660, vx: -300 }));
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
  expect(paddle.vy).toBe(0);
});

it("stops within AI_HOME_DEADZONE of home, wider than the defending deadzone", () => {
  expect(AI_HOME_DEADZONE).toBeGreaterThan(AI_DEADZONE);
  const next = defend(
    { cy: AI_HOME_Y + AI_HOME_DEADZONE, vy: 0 },
    ball({ y: 660, vx: -300 }),
  );
  expect(next.vy).toBe(0);
  expect(next.cy).toBe(AI_HOME_Y + AI_HOME_DEADZONE);
});

it("returns home during the pre-serve hold too", () => {
  let paddle: PaddleMotion = { cy: 600, vy: 0 };
  for (let i = 0; i < 120; i++) {
    paddle = updateAi(paddle, ABLE, ball({ y: 660, vx: 0 }), false, FRAME);
  }
  expect(Math.abs(paddle.cy - AI_HOME_Y)).toBeLessThanOrEqual(AI_HOME_DEADZONE);
});

it("goes home when there is no ball on the field at all", () => {
  const target = aiTarget(ABLE, null, true);
  expect(target).toEqual({
    target: AI_HOME_Y,
    deadzone: AI_HOME_DEADZONE,
  });
});

it("keeps its paddle fully on the field", () => {
  let high: PaddleMotion = { cy: 100, vy: 0 };
  for (let i = 0; i < 120; i++) {
    high = defend(high, ball({ y: -400 }));
  }
  expect(high.cy).toBe(PADDLE_MIN_CY);

  let low: PaddleMotion = { cy: 600, vy: 0 };
  for (let i = 0; i < 120; i++) {
    low = defend(low, ball({ y: 1200 }));
  }
  expect(low.cy).toBe(PADDLE_MAX_CY);
});

describe("the two faculties", () => {
  const incoming = ball({ y: 120 });

  it("senses the ball only while tracking is on", () => {
    expect(aiTarget(ABLE, incoming, true)).toEqual({
      target: 120,
      deadzone: AI_DEADZONE,
    });
    expect(
      aiTarget({ tracking: false, movement: true }, incoming, true),
    ).toEqual({ target: AI_HOME_Y, deadzone: AI_HOME_DEADZONE });
  });

  it("still travels — toward home — with tracking off", () => {
    const next = defend({ cy: 600, vy: 0 }, incoming, {
      tracking: false,
      movement: true,
    });
    expect(next.vy).toBe(-AI_SPEED);
    expect(next.cy).toBeLessThan(600);
  });

  it("stands exactly still, with no velocity, with movement off", () => {
    const next = defend({ cy: 600, vy: 123 }, incoming, {
      tracking: true,
      movement: false,
    });
    expect(next).toEqual({ cy: 600, vy: 0 });
  });

  it("imparts no spin while movement is off, however good its target is", () => {
    // `vy` of 0 is what the spin mechanic reads at contact, so a frozen paddle
    // cannot curve a ball it happens to be touching.
    const next = defend({ cy: 120, vy: 0 }, incoming, {
      tracking: true,
      movement: false,
    });
    expect(next.vy).toBe(0);
  });
});
