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
  centerPaddle,
  clamp,
  createBall,
  createPaddle,
  integratePaddle,
  paddleBounds,
  paddleFrontX,
  paddleRect,
  restBall,
} from "./entities";
import { FIELD_CX, FIELD_CY, HOLD_TIME } from "./constants";
import type { PaddleState } from "./game";

/** A paddle at `cy` moving at `vy`, under nobody's control. */
function paddleAt(cy: number, vy: number): PaddleState {
  return { ...createPaddle(), cy, vy };
}

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
    const paddle = paddleAt(360, 720);
    integratePaddle(paddle, 0.25);
    expect(paddle.cy).toBeCloseTo(540, 9);
    expect(paddle.vy).toBe(720);
  });

  it("clamps to the field and reports the velocity actually achieved", () => {
    const paddle = paddleAt(PADDLE_MAX_CY - 6, 720);
    integratePaddle(paddle, 1 / 60);
    expect(paddle.cy).toBe(PADDLE_MAX_CY);
    // 6 px of the 12 px it asked for, over 1/60 s.
    expect(paddle.vy).toBeCloseTo(360, 9);
  });

  it("reports zero for a paddle already pinned against a bound", () => {
    const paddle = paddleAt(PADDLE_MIN_CY, -720);
    integratePaddle(paddle, 1 / 60);
    expect(paddle.cy).toBe(PADDLE_MIN_CY);
    expect(paddle.vy).toBe(0);
  });

  it("leaves the velocity alone across a zero-length frame", () => {
    const paddle = paddleAt(PADDLE_MIN_CY, -720);
    integratePaddle(paddle, 0);
    expect(paddle.cy).toBe(PADDLE_MIN_CY);
    expect(paddle.vy).toBe(-720);
  });
});

describe("the ball", () => {
  it("derives speed from the velocity", () => {
    expect(ballSpeed({ ...createBall(), vx: 3, vy: 4 })).toBe(5);
  });

  it("spawns at its home point, held, with a full hold and no trail", () => {
    expect(createBall()).toEqual({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      trail: [],
    });
  });

  it("rests a ball in flight back into that same arrangement", () => {
    const ball = createBall();
    ball.x = 1;
    ball.y = 2;
    ball.vx = 3;
    ball.vy = 4;
    ball.spin = 5;
    ball.held = false;
    ball.holdTimer = 0;
    ball.trail.push({ x: 1, y: 2, t: 0.5 });
    const trail = ball.trail;

    restBall(ball);

    expect(ball).toEqual(createBall());
    // The array itself is kept: the renderer and the surface hold it for a frame.
    expect(ball.trail).toBe(trail);
  });
});

describe("createPaddle", () => {
  it("starts centered, still, and under nobody's control", () => {
    expect(createPaddle()).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: 0,
      driven: false,
    });
  });

  it("centers a paddle without handing it back from its driver", () => {
    const paddle: PaddleState = {
      cy: 100,
      vy: -720,
      drivenVy: -720,
      driven: true,
    };
    centerPaddle(paddle);
    expect(paddle).toEqual({
      cy: FIELD_CY,
      vy: 0,
      drivenVy: -720,
      driven: true,
    });
  });
});
