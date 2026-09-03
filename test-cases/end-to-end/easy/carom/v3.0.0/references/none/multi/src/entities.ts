// Carom — the bodies in the field: the paddles, the three balls, and the two
// obstacles.
//
// All three live in `CaromState` as plain data (`src/game.ts`), so this module
// holds no state of its own: it is the arithmetic that reads and writes those
// records, plus the fixed geometry each of them occupies.
//
// WHICH BALLS AND WHICH OBSTACLES ARE PRESENT IS STATE (specs/state.md). Both are
// carried as arrays of what is on the field, each entry under its own `index`, so
// an absent body is absent rather than hidden: it takes no sub-step, it is drawn
// by nothing, and it collides with nothing. The spawns below are what put one
// back, and they are what `spawnBall` and `spawnObstacle` on the debug surface
// call.

import {
  BALL_COUNT,
  BALL_HOMES,
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

/** An obstacle as the axis-aligned rectangle collision resolves against. */
export function obstacleRect(obstacle: ObstacleState): Rect {
  return {
    x0: obstacle.cx - OBSTACLE_HW,
    y0: obstacle.cy - OBSTACLE_HH,
    x1: obstacle.cx + OBSTACLE_HW,
    y1: obstacle.cy + OBSTACLE_HH,
  };
}

/**
 * Advance a paddle by its current velocity and clamp it fully onto the field.
 *
 * When the paddle runs into a bound its REAL vertical velocity is its actual
 * (clamped) displacement over `dt`, not the velocity it was asked for — so a
 * paddle pinned against the top or bottom reports zero and imparts no spin even
 * while a movement action is held. Every mover of a paddle — the input actions,
 * the AI, and the debug surface's driver — comes through here, which is what
 * `specs/playfield.md` requires of all three.
 *
 * A zero-length frame is guarded: a zero step moves nothing and can clamp nothing,
 * and dividing by it would put a NaN into the velocity that drives spin.
 */
export function integratePaddle(paddle: PaddleState, dt: number): void {
  const target = paddle.cy + paddle.vy * dt;
  const clamped = clamp(target, PADDLE_MIN_CY, PADDLE_MAX_CY);
  if (clamped !== target && dt > 0) paddle.vy = (clamped - paddle.cy) / dt;
  paddle.cy = clamped;
}

/** The ball's current speed: the magnitude of its velocity. Never stored. */
export function ballSpeed(ball: BallState): number {
  return Math.hypot(ball.vx, ball.vy);
}

/**
 * Put one ball back on its OWN home point: motionless, spinless, and with an
 * empty trail.
 *
 * `hold` is the wait it starts there. A positive `hold` leaves the ball waiting
 * and solid until that many seconds have passed; `0` leaves it parked and unheld.
 */
export function parkBall(ball: BallState, hold: number): void {
  const home = BALL_HOMES[ball.index];
  ball.x = home.x;
  ball.y = home.y;
  ball.vx = 0;
  ball.vy = 0;
  ball.spin = 0;
  ball.held = hold > 0;
  ball.holdTimer = hold;
  ball.trail.length = 0;
}

/** Whether `index` names one of this variant's balls. */
export function isBallIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < BALL_COUNT;
}

/** Whether `index` names one of the field's obstacles. */
export function isObstacleIndex(index: number): boolean {
  return (
    Number.isInteger(index) && index >= 0 && index < OBSTACLE_CENTERS.length
  );
}

/** The present ball under `index`, or `null` when that ball is off the field. */
export function findBall(
  balls: readonly BallState[],
  index: number,
): BallState | null {
  return balls.find((ball) => ball.index === index) ?? null;
}

/** One ball, freshly placed at its home point and held for `HOLD_TIME`. */
function newBall(index: number, hold: number): BallState {
  const ball: BallState = {
    index,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    spin: 0,
    held: false,
    holdTimer: 0,
    trail: [],
  };
  parkBall(ball, hold);
  return ball;
}

/**
 * Place ball `index` on the field, held at its home point with a wait of `hold`.
 *
 * An index naming no ball is ignored, and a ball already present is returned to
 * exactly the arrangement a fresh one takes, which is what
 * `specs/instrumentation.md` says spawning an entity that is already there does.
 * The array is kept in play order, so a ball spawned back after a `clearWorld`
 * takes its own place in the sequence rather than the end of it.
 */
export function spawnBall(
  balls: BallState[],
  index: number,
  hold: number,
): void {
  if (!isBallIndex(index)) return;
  const existing = findBall(balls, index);
  if (existing !== null) {
    parkBall(existing, hold);
    return;
  }
  balls.push(newBall(index, hold));
  balls.sort((a, b) => a.index - b.index);
}

/**
 * Place obstacle `index` at its fixed center, in the order of
 * `OBSTACLE_CENTERS`. An index naming no obstacle is ignored.
 */
export function spawnObstacle(obstacles: ObstacleState[], index: number): void {
  if (!isObstacleIndex(index)) return;
  const center = OBSTACLE_CENTERS[index];
  const existing = obstacles.find((obstacle) => obstacle.index === index);
  if (existing !== undefined) {
    existing.cx = center.x;
    existing.cy = center.y;
    return;
  }
  obstacles.push({ index, cx: center.x, cy: center.y });
  obstacles.sort((a, b) => a.index - b.index);
}

/** Every ball, in play order, each held at its home point for `hold` seconds. */
export function createBalls(hold: number): BallState[] {
  const balls: BallState[] = [];
  for (let index = 0; index < BALL_COUNT; index += 1) {
    spawnBall(balls, index, hold);
  }
  return balls;
}

/** Both obstacles, at their fixed centers. */
export function createObstacles(): ObstacleState[] {
  const obstacles: ObstacleState[] = [];
  for (let index = 0; index < OBSTACLE_CENTERS.length; index += 1) {
    spawnObstacle(obstacles, index);
  }
  return obstacles;
}
