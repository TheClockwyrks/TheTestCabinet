// Carom — the movable objects in the field: the paddles, the ball, and the
// obstacles that are placed in it.
//
// All three live in `CaromState` as plain data (`src/game.ts`), so this module
// holds no state of its own: it is the arithmetic over those records, each
// function taking one and returning the next, plus the fixed geometry each side's
// paddle and each obstacle occupies.

import {
  FIELD_CX,
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

/**
 * The paddle after being asked to move at `vy` for `dt` seconds, clamped fully
 * onto the field.
 *
 * Every mover of a paddle — the input actions, the AI, and the debug surface's
 * driver — goes through this one rule (specs/playfield.md). When the paddle runs
 * into a bound its REAL vertical velocity is its actual (clamped) displacement
 * over `dt`, not the velocity it was asked for, so a paddle pinned against the
 * top or bottom reports zero and imparts no spin even while a movement action is
 * held. `PaddleState.vy` is documented as exactly that, and the spin mechanic in
 * `src/physics.ts` reads it.
 *
 * A zero-length frame is guarded: a zero step moves nothing and can clamp
 * nothing, and dividing by it would put a NaN into the velocity that drives spin.
 *
 * `driven` and `drivenVy` are carried through untouched: who is moving a paddle
 * and how fast a driven one moves are set by the debug surface alone.
 */
export function integratePaddle(
  paddle: PaddleState,
  vy: number,
  dt: number,
): PaddleState {
  const target = paddle.cy + vy * dt;
  const clamped = clamp(target, PADDLE_MIN_CY, PADDLE_MAX_CY);
  const actual = clamped !== target && dt > 0 ? (clamped - paddle.cy) / dt : vy;
  return { ...paddle, cy: clamped, vy: actual };
}

/** A paddle at the vertical center, stationary, and still whoever's it was. */
export function centeredPaddle(paddle: PaddleState): PaddleState {
  return { ...paddle, cy: FIELD_CY, vy: 0 };
}

/** A fresh, undriven paddle at the vertical center. */
export function newPaddle(): PaddleState {
  return { cy: FIELD_CY, vy: 0, driven: false, drivenVy: 0 };
}

/** The ball's current speed: the magnitude of its velocity. Never stored. */
export function ballSpeed(ball: { vx: number; vy: number }): number {
  return Math.hypot(ball.vx, ball.vy);
}

/**
 * The ball at its home point, held for the full pre-serve wait, motionless, with
 * no spin and no trail. This is what `spawnBall` places and what a match opens
 * with (specs/instrumentation.md, specs/ui.md).
 */
export function homeBall(): BallState {
  return {
    x: FIELD_CX,
    y: FIELD_CY,
    vx: 0,
    vy: 0,
    spin: 0,
    held: true,
    holdTimer: HOLD_TIME,
    trail: [],
  };
}

/** How many obstacles the field has room for, in the order of the centers. */
export const OBSTACLE_COUNT = OBSTACLE_CENTERS.length;

/** Whether `index` names one of the field's obstacles. */
export function isObstacleIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < OBSTACLE_COUNT;
}

/** Obstacle `index` at its fixed center. */
export function obstacleAt(index: number): ObstacleState {
  const center = OBSTACLE_CENTERS[index];
  return { index, cx: center.x, cy: center.y };
}

/** Both obstacles, in the order of OBSTACLE_CENTERS. */
export function allObstacles(): readonly ObstacleState[] {
  return OBSTACLE_CENTERS.map((_, index) => obstacleAt(index));
}

/** One obstacle as the axis-aligned rectangle collision resolves against. */
export function obstacleRect(obstacle: ObstacleState): Rect {
  return {
    x0: obstacle.cx - OBSTACLE_HW,
    y0: obstacle.cy - OBSTACLE_HH,
    x1: obstacle.cx + OBSTACLE_HW,
    y1: obstacle.cy + OBSTACLE_HH,
  };
}
