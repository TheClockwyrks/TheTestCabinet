// The paddle integrator is the one piece of `entities.ts` with a rule behind it:
// `PaddleState.vy` is the paddle's REAL velocity, so a paddle pinned against a
// bound must report zero — that is what stops it imparting spin while a movement
// action is held against the edge of the field. Every function returns a new
// record; what it was handed is asserted untouched where that matters.

import { describe, expect, it } from "vitest";
import {
  BALL_COUNT,
  BALL_HOMES,
  FIELD_CY,
  HOLD_TIME,
  OBSTACLE_CENTERS,
  OBSTACLE_HH,
  OBSTACLE_HW,
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
  centeredPaddle,
  clamp,
  createBalls,
  createObstacles,
  integratePaddle,
  makeObstacle,
  obstacleRect,
  paddleBounds,
  paddleFrontX,
  paddleRect,
  parkBall,
  placeByIndex,
} from "./entities";
import type { PaddleState } from "./game";

/** A paddle under the player, which is how every screen starts one. */
function paddle(patch: Partial<PaddleState> = {}): PaddleState {
  return { cy: 360, vy: 0, driven: false, drivenVy: 0, ...patch };
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
    const moved = integratePaddle(paddle({ vy: 720 }), 0.25);
    expect(moved.cy).toBeCloseTo(540, 9);
    expect(moved.vy).toBe(720);
  });

  it("returns a new paddle and leaves the one it was handed alone", () => {
    const before = paddle({ vy: 720 });
    const after = integratePaddle(before, 0.25);
    expect(before).toEqual(paddle({ vy: 720 }));
    expect(after).not.toBe(before);
  });

  it("carries `driven` and `drivenVy` through untouched", () => {
    const moved = integratePaddle(
      paddle({ vy: 300, driven: true, drivenVy: 300 }),
      0.25,
    );
    expect(moved.driven).toBe(true);
    expect(moved.drivenVy).toBe(300);
  });

  it("clamps to the field and reports the velocity actually achieved", () => {
    const moved = integratePaddle(
      paddle({ cy: PADDLE_MAX_CY - 6, vy: 720 }),
      1 / 60,
    );
    expect(moved.cy).toBe(PADDLE_MAX_CY);
    // 6 px of the 12 px it asked for, over 1/60 s.
    expect(moved.vy).toBeCloseTo(360, 9);
  });

  it("reports zero for a paddle already pinned against a bound", () => {
    const moved = integratePaddle(
      paddle({ cy: PADDLE_MIN_CY, vy: -720 }),
      1 / 60,
    );
    expect(moved.cy).toBe(PADDLE_MIN_CY);
    expect(moved.vy).toBe(0);
  });

  it("leaves the velocity alone across a zero-length frame", () => {
    const moved = integratePaddle(paddle({ cy: PADDLE_MIN_CY, vy: -720 }), 0);
    expect(moved.cy).toBe(PADDLE_MIN_CY);
    expect(moved.vy).toBe(-720);
  });

  it("starts a paddle centered, stationary, and under the player", () => {
    expect(centeredPaddle()).toEqual({
      cy: FIELD_CY,
      vy: 0,
      driven: false,
      drivenVy: 0,
    });
  });
});

describe("the balls", () => {
  it("derives speed from the velocity", () => {
    expect(ballSpeed(createBalls(0)[0])).toBe(0);
    expect(ballSpeed({ ...createBalls(0)[0], vx: 3, vy: 4 })).toBe(5);
  });

  it("builds one ball per home point, each under its own index", () => {
    const balls = createBalls(HOLD_TIME);
    expect(balls).toHaveLength(BALL_COUNT);
    balls.forEach((ball, index) => {
      expect(ball).toEqual({
        index,
        x: BALL_HOMES[index].x,
        y: BALL_HOMES[index].y,
        vx: 0,
        vy: 0,
        spin: 0,
        held: true,
        holdTimer: HOLD_TIME,
        trail: [],
      });
    });
  });

  it("parks a ball on its OWN home with the wait it is given", () => {
    expect(parkBall(2, 1.0)).toEqual({
      index: 2,
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
    const ball = parkBall(1, 0);
    expect(ball.held).toBe(false);
    expect(ball.holdTimer).toBe(0);
  });

  it("builds a fresh ball on every call, sharing nothing between them", () => {
    const one = parkBall(0, 1);
    const two = parkBall(0, 1);
    expect(one).toEqual(two);
    expect(one).not.toBe(two);
    expect(one.trail).not.toBe(two.trail);
  });
});

describe("the obstacles", () => {
  it("places each one on its own fixed center", () => {
    OBSTACLE_CENTERS.forEach((center, index) => {
      expect(makeObstacle(index)).toEqual({
        index,
        cx: center.x,
        cy: center.y,
      });
    });
  });

  it("builds both, in the order OBSTACLE_CENTERS lists them", () => {
    expect(createObstacles().map((o) => o.index)).toEqual([0, 1]);
  });

  it("resolves against the rectangle its half-extents fix", () => {
    expect(obstacleRect(makeObstacle(0))).toEqual({
      x0: OBSTACLE_CENTERS[0].x - OBSTACLE_HW,
      y0: OBSTACLE_CENTERS[0].y - OBSTACLE_HH,
      x1: OBSTACLE_CENTERS[0].x + OBSTACLE_HW,
      y1: OBSTACLE_CENTERS[0].y + OBSTACLE_HH,
    });
  });
});

describe("placeByIndex", () => {
  it("inserts an entity in index order rather than at the end", () => {
    const placed = placeByIndex(
      [parkBall(0, 0), parkBall(2, 0)],
      parkBall(1, 0),
    );
    expect(placed.map((ball) => ball.index)).toEqual([0, 1, 2]);
  });

  it("replaces the entity already under that index", () => {
    const placed = placeByIndex([parkBall(1, 0)], parkBall(1, HOLD_TIME));
    expect(placed).toHaveLength(1);
    expect(placed[0].holdTimer).toBe(HOLD_TIME);
  });

  it("returns a new list and leaves the one it was handed alone", () => {
    const before = [parkBall(0, 0)];
    const after = placeByIndex(before, parkBall(1, 0));
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });
});
