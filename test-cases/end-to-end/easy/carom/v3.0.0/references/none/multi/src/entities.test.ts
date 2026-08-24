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
import { BALL_COUNT, BALL_HOMES } from "./constants";
import {
  ballSpeed,
  clamp,
  createBalls,
  integratePaddle,
  paddleBounds,
  paddleFrontX,
  paddleRect,
} from "./entities";
import { parkBall } from "./entities";
import type { PaddleState } from "./game";

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
    const paddle: PaddleState = { cy: 360, vy: 720 };
    integratePaddle(paddle, 0.25);
    expect(paddle.cy).toBeCloseTo(540, 9);
    expect(paddle.vy).toBe(720);
  });

  it("clamps to the field and reports the velocity actually achieved", () => {
    const paddle: PaddleState = { cy: PADDLE_MAX_CY - 6, vy: 720 };
    integratePaddle(paddle, 1 / 60);
    expect(paddle.cy).toBe(PADDLE_MAX_CY);
    // 6 px of the 12 px it asked for, over 1/60 s.
    expect(paddle.vy).toBeCloseTo(360, 9);
  });

  it("reports zero for a paddle already pinned against a bound", () => {
    const paddle: PaddleState = { cy: PADDLE_MIN_CY, vy: -720 };
    integratePaddle(paddle, 1 / 60);
    expect(paddle.cy).toBe(PADDLE_MIN_CY);
    expect(paddle.vy).toBe(0);
  });

  it("leaves the velocity alone across a zero-length frame", () => {
    const paddle: PaddleState = { cy: PADDLE_MIN_CY, vy: -720 };
    integratePaddle(paddle, 0);
    expect(paddle.cy).toBe(PADDLE_MIN_CY);
    expect(paddle.vy).toBe(-720);
  });
});

describe("the balls", () => {
  it("derives speed from the velocity", () => {
    expect(ballSpeed(createBalls()[0])).toBe(0);
    const moving = createBalls()[0];
    moving.vx = 3;
    moving.vy = 4;
    expect(ballSpeed(moving)).toBe(5);
  });

  it("builds one ball per home point, parked and unheld", () => {
    const balls = createBalls();
    expect(balls).toHaveLength(BALL_COUNT);
    balls.forEach((ball, index) => {
      expect(ball).toEqual({
        x: BALL_HOMES[index].x,
        y: BALL_HOMES[index].y,
        vx: 0,
        vy: 0,
        spin: 0,
        held: false,
        holdTimer: 0,
        trail: [],
      });
    });
  });

  it("parks a ball back on its OWN home with the wait it is given", () => {
    const ball = createBalls()[0];
    Object.assign(ball, { x: 1, y: 2, vx: 3, vy: 4, spin: 5 });
    ball.trail.push({ x: 1, y: 2, t: 0 });

    parkBall(ball, 2, 1.0);

    expect(ball).toEqual({
      x: BALL_HOMES[2].x,
      y: BALL_HOMES[2].y,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: 1.0,
      trail: [],
    });
  });

  it("leaves a ball parked and unheld when the wait is zero", () => {
    const ball = createBalls()[1];
    parkBall(ball, 1, 0);
    expect(ball.held).toBe(false);
    expect(ball.holdTimer).toBe(0);
  });
});
