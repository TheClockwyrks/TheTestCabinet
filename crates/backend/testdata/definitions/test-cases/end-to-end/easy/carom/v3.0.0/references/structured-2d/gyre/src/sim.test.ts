// The paddle integrator is the one piece of `sim.ts` with a rule behind it:
// a paddle's `vy` is its REAL velocity, so a paddle pinned against a bound
// must report zero — that is what stops it imparting spin while a movement
// action is held against the edge of the field.

import { describe, expect, it } from "vitest";
import {
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  PADDLE_HALF,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
} from "./constants";
import {
  ballSpeed,
  clamp,
  integratePaddle,
  paddleBounds,
  paddleCenterX,
  paddleFrontX,
  paddleRect,
  parkedBall,
  type PaddleSim,
} from "./sim";

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

  it("centers each paddle actor on its own bar", () => {
    expect(paddleCenterX("left")).toBe((P1_X0 + P1_X1) / 2);
    expect(paddleCenterX("right")).toBe((P2_X0 + P2_X1) / 2);
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
    const paddle = integratePaddle({ cy: 360, vy: 720 }, 0.25);
    expect(paddle.cy).toBeCloseTo(540, 9);
    expect(paddle.vy).toBe(720);
  });

  it("clamps to the field and reports the velocity actually achieved", () => {
    const paddle = integratePaddle({ cy: PADDLE_MAX_CY - 6, vy: 720 }, 1 / 60);
    expect(paddle.cy).toBe(PADDLE_MAX_CY);
    // 6 px of the 12 px it asked for, over 1/60 s.
    expect(paddle.vy).toBeCloseTo(360, 9);
  });

  it("reports zero for a paddle already pinned against a bound", () => {
    const paddle = integratePaddle({ cy: PADDLE_MIN_CY, vy: -720 }, 1 / 60);
    expect(paddle.cy).toBe(PADDLE_MIN_CY);
    expect(paddle.vy).toBe(0);
  });

  it("leaves the velocity alone across a zero-length frame", () => {
    const paddle = integratePaddle({ cy: PADDLE_MIN_CY, vy: -720 }, 0);
    expect(paddle.cy).toBe(PADDLE_MIN_CY);
    expect(paddle.vy).toBe(-720);
  });

  it("returns a new paddle and leaves the one it was given alone", () => {
    const before: PaddleSim = { cy: 360, vy: 720 };
    const after = integratePaddle(before, 0.25);
    expect(after).not.toBe(before);
    expect(before).toEqual({ cy: 360, vy: 720 });
  });
});

describe("the ball", () => {
  it("derives speed from the velocity", () => {
    expect(ballSpeed({ x: 0, y: 0, vx: 3, vy: 4, spin: 0 })).toBe(5);
  });

  it("parks at the field center with no motion and no spin", () => {
    expect(parkedBall()).toEqual({ x: 640, y: 360, vx: 0, vy: 0, spin: 0 });
  });
});
