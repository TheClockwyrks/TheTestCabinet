// The paddle integrator is the one piece of `entities.ts` with a rule behind it:
// `PaddleState.vy` is the paddle's REAL velocity, so a paddle pinned against a
// bound must report zero — that is what stops it imparting spin while a movement
// action is held against the edge of the field. Beside it sits the geometry the
// collision resolves against and the two entities the debug surface spawns.

import { describe, expect, it } from "vitest";
import {
  FIELD_CY,
  HOLD_TIME,
  OBSTACLE_CENTERS,
  OBSTACLE_HH,
  OBSTACLE_HW,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  PADDLE_HALF,
} from "./constants";
import {
  allObstacles,
  ballSpeed,
  centeredPaddle,
  clamp,
  homeBall,
  integratePaddle,
  isObstacleIndex,
  newPaddle,
  obstacleAt,
  obstacleRect,
  paddleBounds,
  paddleFrontX,
  paddleRect,
} from "./entities";
import type { PaddleState } from "./game";

function paddle(cy: number, vy = 0): PaddleState {
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
    const moved = integratePaddle(paddle(360), 720, 0.25);
    expect(moved.cy).toBeCloseTo(540, 9);
    expect(moved.vy).toBe(720);
  });

  it("clamps to the field and reports the velocity actually achieved", () => {
    const moved = integratePaddle(paddle(PADDLE_MAX_CY - 6), 720, 1 / 60);
    expect(moved.cy).toBe(PADDLE_MAX_CY);
    // 6 units of the 12 it asked for, over 1/60 s.
    expect(moved.vy).toBeCloseTo(360, 9);
  });

  it("reports zero for a paddle already pinned against a bound", () => {
    const moved = integratePaddle(paddle(PADDLE_MIN_CY), -720, 1 / 60);
    expect(moved.cy).toBe(PADDLE_MIN_CY);
    expect(moved.vy).toBe(0);
  });

  it("leaves the velocity alone across a zero-length frame", () => {
    const moved = integratePaddle(paddle(PADDLE_MIN_CY), -720, 0);
    expect(moved.cy).toBe(PADDLE_MIN_CY);
    expect(moved.vy).toBe(-720);
  });

  it("carries the driven flags through untouched", () => {
    const driven: PaddleState = { cy: 360, vy: 0, driven: true, drivenVy: 300 };
    const moved = integratePaddle(driven, 300, 0.1);
    expect(moved.driven).toBe(true);
    expect(moved.drivenVy).toBe(300);
    expect(moved.cy).toBeCloseTo(390, 9);
  });

  it("returns a new paddle and leaves the one it was given alone", () => {
    const before = paddle(360, 720);
    const after = integratePaddle(before, 720, 0.25);
    expect(after).not.toBe(before);
    expect(before).toEqual(paddle(360, 720));
  });
});

describe("the paddles a match opens with", () => {
  it("builds a fresh paddle centered, still, and nobody's but the player's", () => {
    expect(newPaddle()).toEqual({
      cy: FIELD_CY,
      vy: 0,
      driven: false,
      drivenVy: 0,
    });
  });

  it("recenters a paddle without handing a driven one back", () => {
    const driven: PaddleState = { cy: 120, vy: 400, driven: true, drivenVy: 5 };
    expect(centeredPaddle(driven)).toEqual({
      cy: FIELD_CY,
      vy: 0,
      driven: true,
      drivenVy: 5,
    });
  });
});

describe("the ball", () => {
  it("derives speed from the velocity", () => {
    expect(ballSpeed({ vx: 3, vy: 4 })).toBe(5);
  });

  it("waits at the field center with no motion, no spin, and no trail", () => {
    expect(homeBall()).toEqual({
      x: 640,
      y: 360,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      serveSign: expect.any(Number),
      trail: [],
    });
  });

  it("draws a serve sign of +1 or -1 for every parked ball", () => {
    for (let i = 0; i < 50; i++) {
      expect(Math.abs(homeBall().serveSign)).toBe(1);
    }
  });
});

describe("the obstacles", () => {
  it("names only the two the field has", () => {
    expect(isObstacleIndex(0)).toBe(true);
    expect(isObstacleIndex(1)).toBe(true);
    expect(isObstacleIndex(2)).toBe(false);
    expect(isObstacleIndex(-1)).toBe(false);
    expect(isObstacleIndex(0.5)).toBe(false);
  });

  it("places each at its own fixed center, in the order of the centers", () => {
    expect(allObstacles()).toEqual([
      { index: 0, cx: OBSTACLE_CENTERS[0].x, cy: OBSTACLE_CENTERS[0].y },
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);
  });

  it("resolves against the half-extents specs/playfield.md fixes", () => {
    const a = obstacleAt(0);
    expect(obstacleRect(a)).toEqual({
      x0: a.cx - OBSTACLE_HW,
      y0: a.cy - OBSTACLE_HH,
      x1: a.cx + OBSTACLE_HW,
      y1: a.cy + OBSTACLE_HH,
    });
  });
});
