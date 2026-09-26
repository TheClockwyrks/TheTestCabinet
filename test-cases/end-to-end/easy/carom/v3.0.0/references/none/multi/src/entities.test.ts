// The paddle integrator is the one piece of `entities.ts` with a rule behind it:
// `PaddleState.vy` is the paddle's REAL velocity, so a paddle pinned against a
// bound must report zero — that is what stops it imparting spin while a movement
// action is held against the edge of the field.
//
// The spawns are the other half. Which balls and which obstacles are PRESENT is
// state (specs/state.md), so placing one, placing one that is already there, and
// naming one that does not exist each have a stated outcome.

import { describe, expect, it } from "vitest";
import {
  BALL_COUNT,
  BALL_HOMES,
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
  clamp,
  createBalls,
  createObstacles,
  findBall,
  integratePaddle,
  isBallIndex,
  isObstacleIndex,
  obstacleRect,
  paddleBounds,
  paddleFrontX,
  paddleRect,
  parkBall,
  spawnBall,
  spawnObstacle,
} from "./entities";
import type { BallState, ObstacleState, PaddleState } from "./game";

function paddle(cy: number, vy: number): PaddleState {
  return { cy, vy, driven: false, drivenVy: 0 };
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
    const p = paddle(360, 720);
    integratePaddle(p, 0.25);
    expect(p.cy).toBeCloseTo(540, 9);
    expect(p.vy).toBe(720);
  });

  it("clamps to the field and reports the velocity actually achieved", () => {
    const p = paddle(PADDLE_MAX_CY - 6, 720);
    integratePaddle(p, 1 / 60);
    expect(p.cy).toBe(PADDLE_MAX_CY);
    // 6 px of the 12 px it asked for, over 1/60 s.
    expect(p.vy).toBeCloseTo(360, 9);
  });

  it("reports zero for a paddle already pinned against a bound", () => {
    const p = paddle(PADDLE_MIN_CY, -720);
    integratePaddle(p, 1 / 60);
    expect(p.cy).toBe(PADDLE_MIN_CY);
    expect(p.vy).toBe(0);
  });

  it("leaves the velocity alone across a zero-length frame", () => {
    const p = paddle(PADDLE_MIN_CY, -720);
    integratePaddle(p, 0);
    expect(p.cy).toBe(PADDLE_MIN_CY);
    expect(p.vy).toBe(-720);
  });
});

describe("the balls", () => {
  it("derives speed from the velocity", () => {
    expect(ballSpeed(createBalls(0)[0])).toBe(0);
    const moving = createBalls(0)[0];
    moving.vx = 3;
    moving.vy = 4;
    expect(ballSpeed(moving)).toBe(5);
  });

  it("builds one ball per home point, in play order", () => {
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
        launchAngle: expect.any(Number),
        trail: [],
      });
    });
  });

  it("parks a ball back on its OWN home with the wait it is given", () => {
    const balls = createBalls(0);
    const ball = balls[2];
    Object.assign(ball, { x: 1, y: 2, vx: 3, vy: 4, spin: 5 });
    ball.trail.push({ x: 1, y: 2, t: 0 });

    parkBall(ball, 1.0);

    expect(ball).toEqual({
      index: 2,
      x: BALL_HOMES[2].x,
      y: BALL_HOMES[2].y,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: 1.0,
      launchAngle: expect.any(Number),
      trail: [],
    });
  });

  it("leaves a ball parked and unheld when the wait is zero", () => {
    const ball = createBalls(0)[1];
    parkBall(ball, 0);
    expect(ball.held).toBe(false);
    expect(ball.holdTimer).toBe(0);
  });
});

describe("spawning a ball", () => {
  it("keeps the balls in play order however they are spawned back", () => {
    const balls: BallState[] = [];
    spawnBall(balls, 2, HOLD_TIME);
    spawnBall(balls, 0, HOLD_TIME);
    expect(balls.map((ball) => ball.index)).toEqual([0, 2]);
  });

  it("returns a ball already present to the arrangement a fresh one takes", () => {
    const balls = createBalls(0);
    Object.assign(balls[1], { x: 5, y: 6, vx: 7, vy: 8, spin: 9, held: false });
    balls[1].trail.push({ x: 5, y: 6, t: 1 });

    spawnBall(balls, 1, HOLD_TIME);

    expect(balls).toHaveLength(BALL_COUNT);
    expect(balls[1]).toEqual({
      index: 1,
      x: BALL_HOMES[1].x,
      y: BALL_HOMES[1].y,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      launchAngle: expect.any(Number),
      trail: [],
    });
  });

  it("ignores an index that names no ball", () => {
    const balls: BallState[] = [];
    spawnBall(balls, -1, HOLD_TIME);
    spawnBall(balls, BALL_COUNT, HOLD_TIME);
    spawnBall(balls, 0.5, HOLD_TIME);
    expect(balls).toEqual([]);
    expect(isBallIndex(0)).toBe(true);
    expect(isBallIndex(BALL_COUNT)).toBe(false);
  });

  it("finds a present ball by index and answers null for an absent one", () => {
    const balls = createBalls(0);
    expect(findBall(balls, 2)?.index).toBe(2);
    balls.length = 0;
    expect(findBall(balls, 2)).toBeNull();
  });
});

describe("spawning an obstacle", () => {
  it("places both at their fixed centers, in order", () => {
    expect(createObstacles()).toEqual(
      OBSTACLE_CENTERS.map((center, index) => ({
        index,
        cx: center.x,
        cy: center.y,
      })),
    );
  });

  it("returns a displaced obstacle to its fixed center", () => {
    const obstacles = createObstacles();
    obstacles[1].cx = 0;
    obstacles[1].cy = 0;
    spawnObstacle(obstacles, 1);
    expect(obstacles).toHaveLength(OBSTACLE_CENTERS.length);
    expect(obstacles[1]).toEqual({
      index: 1,
      cx: OBSTACLE_CENTERS[1].x,
      cy: OBSTACLE_CENTERS[1].y,
    });
  });

  it("keeps the obstacles in index order however they are spawned back", () => {
    const obstacles: ObstacleState[] = [];
    spawnObstacle(obstacles, 1);
    spawnObstacle(obstacles, 0);
    expect(obstacles.map((obstacle) => obstacle.index)).toEqual([0, 1]);
  });

  it("ignores an index that names no obstacle", () => {
    const obstacles: ObstacleState[] = [];
    spawnObstacle(obstacles, 2);
    spawnObstacle(obstacles, -1);
    expect(obstacles).toEqual([]);
    expect(isObstacleIndex(1)).toBe(true);
    expect(isObstacleIndex(2)).toBe(false);
  });

  it("gives an obstacle the half-extents specs/playfield.md fixes", () => {
    expect(obstacleRect({ index: 0, cx: 100, cy: 200 })).toEqual({
      x0: 100 - OBSTACLE_HW,
      y0: 200 - OBSTACLE_HH,
      x1: 100 + OBSTACLE_HW,
      y1: 200 + OBSTACLE_HH,
    });
  });
});
