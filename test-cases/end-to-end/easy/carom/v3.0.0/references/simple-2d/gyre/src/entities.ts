// Carom — the movable objects in the field: the paddles and the ball.
//
// Both live in `CaromState` as plain data (`src/game.ts`), so this module holds no
// state of its own: it is the arithmetic over those records — each function takes
// a record as a read-only view and returns the next one — plus the fixed geometry
// each side's paddle occupies. The obstacles are posed in `src/obstacles.ts`.

import {
  FIELD_CX,
  FIELD_CY,
  HOLD_TIME,
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  PADDLE_HALF,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  type Rect,
} from "./constants";
import type { BallState, Side } from "./game";
import type { DeepReadonly } from "ts-essentials";

/**
 * The part of a ball the physics moves: where it is, where it is going, and how
 * hard it is curving.
 *
 * `BallState` carries this plus the pre-serve hold and the trail, neither of
 * which a collision touches, so `src/physics.ts` is written against this narrower
 * shape and the caller merges the result back into the ball it came from.
 */
export interface Kinematics {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly spin: number;
}

/** The part of a paddle a collision and the integrator read. */
export interface PaddleMotion {
  readonly cy: number;
  readonly vy: number;
}

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
 * The paddle advanced by its current velocity and clamped fully onto the field.
 *
 * When the paddle runs into a bound its REAL vertical velocity is its actual
 * (clamped) displacement over `dt`, not the velocity it was asked for — so a
 * paddle pinned against the top or bottom reports zero and imparts no spin even
 * while a movement action is held. `PaddleState.vy` is documented as exactly that,
 * and the spin mechanic in `src/physics.ts` reads it.
 *
 * This is the ONE integrator every mover of a paddle goes through — the player's
 * actions, the AI, and the debug surface's driven velocity alike
 * (specs/playfield.md) — so a driven paddle is clamped by exactly the rule a
 * played one is.
 *
 * A zero-length frame is guarded: a zero step moves nothing and can clamp nothing,
 * and dividing by it would put a NaN into the velocity that drives spin.
 */
export function integratePaddle(
  paddle: DeepReadonly<PaddleMotion>,
  dt: number,
): PaddleMotion {
  const target = paddle.cy + paddle.vy * dt;
  const clamped = clamp(target, PADDLE_MIN_CY, PADDLE_MAX_CY);
  const vy =
    clamped !== target && dt > 0 ? (clamped - paddle.cy) / dt : paddle.vy;
  return { cy: clamped, vy };
}

/** The ball's current speed: the magnitude of its velocity. Never stored. */
export function ballSpeed(ball: DeepReadonly<Kinematics>): number {
  return Math.hypot(ball.vx, ball.vy);
}

/**
 * The ball as `spawnBall` and every respawn place it: at its home point, held
 * for a full `HOLD_TIME`, motionless, with no spin and no trail
 * (specs/instrumentation.md).
 */
export function parkedBall(): BallState {
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
