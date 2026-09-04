// The paddle integrator is the one piece of `entities.ts` with a rule behind it:
// `PaddleState.vy` is the paddle's REAL velocity, so a paddle pinned against a
// bound must report zero — that is what stops it imparting spin while a movement
// action is held against the edge of the field.

import { describe, expect, it } from "vitest";
import {
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  PADDLE_HALF,
} from "./constants";
import {
  ballSpeed,
  clamp,
  integratePaddle,
  paddleBounds,
  paddleFrontX,
  paddleRect,
  parkedBall,
  type PaddleMotion,
} from "./entities";
import { HOLD_TIME } from "./constants";
import type { BallState } from "./game";

describe("clamp", () => {
  it("passes a value inside the range through", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to either bound", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("paddle geometry", () => {
  it("puts each side at the x range specs/playfield.md fixes", () => {
    expect(paddleBounds("left")).toEqual({ x0: P1_X0, x1: P1_X1 });
    expect(paddleBounds("right")).toEqual({ x0: P2_X0, x1: P2_X1 });
  });

  it("faces the field with the inner edge of each paddle", () => {
    expect(paddleFrontX("left")).toBe(P1_X1);
    expect(paddleFrontX("right")).toBe(P2_X0);
  });

  it("centers the collision rectangle on the paddle", () => {
    expect(paddleRect("left", 360)).toEqual({
      x0: P1_X0,
      y0: 360 - PADDLE_HALF,
      x1: P1_X1,
      y1: 360 + PADDLE_HALF,
    });
  });
});

describe("integratePaddle", () => {
  it("advances by the velocity over the elapsed time", () => {
    const paddle: PaddleMotion = { cy: 360, vy: 720 };
    const next = integratePaddle(paddle, 0.25);
    expect(next.cy).toBeCloseTo(540, 9);
    expect(next.vy).toBe(720);
    // The paddle it was handed is as it was.
    expect(paddle).toEqual({ cy: 360, vy: 720 });
  });

  it("clamps to the field and reports the velocity actually achieved", () => {
    const next = integratePaddle({ cy: PADDLE_MAX_CY - 6, vy: 720 }, 1 / 60);
    expect(next.cy).toBe(PADDLE_MAX_CY);
    // 6 px of the 12 px it asked for, over 1/60 s.
    expect(next.vy).toBeCloseTo(360, 9);
  });

  it("reports zero for a paddle already pinned against a bound", () => {
    const next = integratePaddle({ cy: PADDLE_MIN_CY, vy: -720 }, 1 / 60);
    expect(next.cy).toBe(PADDLE_MIN_CY);
    expect(next.vy).toBe(0);
  });

  it("leaves the velocity alone across a zero-length frame", () => {
    const next = integratePaddle({ cy: PADDLE_MIN_CY, vy: -720 }, 0);
    expect(next.cy).toBe(PADDLE_MIN_CY);
    expect(next.vy).toBe(-720);
  });
});

describe("the ball", () => {
  it("derives speed from the velocity", () => {
    expect(ballSpeed({ x: 0, y: 0, vx: 3, vy: 4, spin: 0 })).toBe(5);
  });

  it("parks at the field center, held for a full hold, with no trail", () => {
    const ball: BallState = parkedBall();
    expect(ball).toEqual({
      x: 640,
      y: 360,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      trail: [],
    });
    // A fresh value each time, never a shared one.
    expect(parkedBall()).not.toBe(ball);
    expect(parkedBall().trail).not.toBe(ball.trail);
  });
});
