// Carom — the objects in the field: the paddles, the balls, and the obstacles.
//
// All three live in `CaromState` as plain data (`src/game.ts`), so this module
// holds no state of its own: it is the arithmetic over those records, plus the
// fixed geometry each side's paddle occupies. Every function here takes a record
// and returns a new one; none writes to what it is handed.
//
// WHICH balls and WHICH obstacles are present is state (specs/state.md), so this
// module also carries the two builders that put one back: `parkBall` places a
// ball on its own home point, and `makeObstacle` places an obstacle on its own
// fixed center.

import {
  BALL_COUNT,
  BALL_HOMES,
  FIELD_CY,
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
  type Rect,
} from "./constants";
import type { BallState, ObstacleState, PaddleState, Side } from "./game";
import type { DeepReadonly } from "ts-essentials";
import { drawLaunchAngle } from "./random";

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The fixed horizontal extent of a side's paddle. */
export function paddleBounds(side: Side): { x0: number; x1: number } {
  return side === "left" ? { x0: P1_X0, x1: P1_X1 } : { x0: P2_X0, x1: P2_X1 };
}

/** The field-facing face of a side's paddle: the one the ball can strike. */
export function paddleFrontX(side: Side): number {
  return side === "left" ? P1_X1 : P2_X0;
}

/** A side's paddle as the axis-aligned rectangle collision resolves against. */
export function paddleRect(side: Side, cy: number): Rect {
  const { x0, x1 } = paddleBounds(side);
  return { x0, y0: cy - PADDLE_HALF, x1, y1: cy + PADDLE_HALF };
}

/** A paddle at the vertical center, stationary, and under the player. */
export function centeredPaddle(): PaddleState {
  return { cy: FIELD_CY, vy: 0, driven: false, drivenVy: 0 };
}

/**
 * The paddle advanced by its current velocity and clamped fully onto the field.
 *
 * When the paddle runs into a bound its REAL vertical velocity is its actual
 * (clamped) displacement over `dt`, not the velocity it was asked for — so a
 * paddle pinned against the top or bottom reports zero and imparts no spin even
 * while a movement action is held. `PaddleState.vy` is documented as exactly that,
 * and the spin mechanic in `src/physics.ts` reads it.
 *
 * `driven` and `drivenVy` are carried through untouched: whoever is moving the
 * paddle and how fast a driven one travels are not the integrator's business.
 *
 * A zero-length frame is guarded: a zero step moves nothing and can clamp nothing,
 * and dividing by it would put a NaN into the velocity that drives spin.
 */
export function integratePaddle(
  paddle: DeepReadonly<PaddleState>,
  dt: number,
): PaddleState {
  const target = paddle.cy + paddle.vy * dt;
  const clamped = clamp(target, PADDLE_MIN_CY, PADDLE_MAX_CY);
  const vy =
    clamped !== target && dt > 0 ? (clamped - paddle.cy) / dt : paddle.vy;
  return {
    cy: clamped,
    vy,
    driven: paddle.driven,
    drivenVy: paddle.drivenVy,
  };
}

/** The ball's current speed: the magnitude of its velocity. Never stored. */
export function ballSpeed(ball: { vx: number; vy: number }): number {
  return Math.hypot(ball.vx, ball.vy);
}

/**
 * Ball `index` parked on its OWN home point: motionless, spinless, and with an
 * empty trail.
 *
 * `hold` is the wait it starts there. A positive `hold` leaves the ball waiting
 * and solid until that many seconds have passed. Every field is fixed by the home
 * and the hold, so nothing of the ball's previous state is needed to build it.
 */
export function parkBall(index: number, hold: number): BallState {
  const home = BALL_HOMES[index];
  return {
    index,
    x: home.x,
    y: home.y,
    vx: 0,
    vy: 0,
    spin: 0,
    held: hold > 0,
    holdTimer: hold,
    launchAngle: drawLaunchAngle(),
    trail: [],
  };
}

/** The three balls, in play order, each waiting out `hold` on its own home. */
export function createBalls(hold: number): BallState[] {
  return BALL_HOMES.slice(0, BALL_COUNT).map((_home, index) =>
    parkBall(index, hold),
  );
}

/** Obstacle `index` at its own fixed center. */
export function makeObstacle(index: number): ObstacleState {
  const center = OBSTACLE_CENTERS[index];
  return { index, cx: center.x, cy: center.y };
}

/** Both obstacles, in the order of OBSTACLE_CENTERS. */
export function createObstacles(): ObstacleState[] {
  return OBSTACLE_CENTERS.map((_center, index) => makeObstacle(index));
}

/** An obstacle as the axis-aligned rectangle collision resolves against. */
export function obstacleRect(obstacle: DeepReadonly<ObstacleState>): Rect {
  return {
    x0: obstacle.cx - OBSTACLE_HW,
    y0: obstacle.cy - OBSTACLE_HH,
    x1: obstacle.cx + OBSTACLE_HW,
    y1: obstacle.cy + OBSTACLE_HH,
  };
}

/**
 * `entity` put into `list`, replacing whatever was already under its index and
 * keeping the list in index order.
 *
 * Which balls and which obstacles are present is state, so spawning one has to
 * put it back where play order says it belongs rather than at the end.
 */
export function placeByIndex<T extends { readonly index: number }>(
  list: readonly T[],
  entity: T,
): T[] {
  const out = list.filter((existing) => existing.index !== entity.index);
  out.push(entity);
  out.sort((a, b) => a.index - b.index);
  return out;
}
