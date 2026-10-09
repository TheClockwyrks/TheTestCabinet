// Carom — the movable objects in the field: the paddles and the ball.
//
// Both live in `CaromState` as plain data (`src/game.ts`), so this module holds no
// state of its own: it is the arithmetic that reads and writes those records, plus
// the fixed geometry each side's paddle occupies. The obstacle poses are
// `src/obstacles.ts`.

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
import type { BallState, PaddleState, Side } from "./game";
import { drawServeSign } from "./random";

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

/** A paddle at rest in the middle of the field, under nobody's control. */
export function createPaddle(): PaddleState {
  return { cy: FIELD_CY, vy: 0, drivenVy: 0, driven: false };
}

/** Put a paddle back at the vertical center, stationary. Leaves who drives it. */
export function centerPaddle(paddle: PaddleState): void {
  paddle.cy = FIELD_CY;
  paddle.vy = 0;
}

/**
 * Advance a paddle by its current velocity and clamp it fully onto the field.
 *
 * When the paddle runs into a bound its REAL vertical velocity is its actual
 * (clamped) displacement over `dt`, not the velocity it was asked for — so a
 * paddle pinned against the top or bottom reports zero and imparts no spin even
 * while a movement action is held. `PaddleState.vy` is documented as exactly that,
 * and the spin mechanic in `src/physics.ts` reads it.
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
 * Park the ball at its home point, waiting out a full pre-serve hold.
 *
 * The one arrangement `spawnBall`, the start of a match, and the respawn after a
 * point all put the ball into (specs/balls.md, specs/instrumentation.md): at the
 * field center, motionless, unspun, held, with a full `holdTimer` and no trail.
 */
export function restBall(ball: BallState): void {
  ball.x = FIELD_CX;
  ball.y = FIELD_CY;
  ball.vx = 0;
  ball.vy = 0;
  ball.spin = 0;
  ball.held = true;
  ball.holdTimer = HOLD_TIME;
  ball.trail.length = 0;
}

/** A new ball, in the arrangement {@link restBall} describes. */
export function createBall(): BallState {
  const ball: BallState = {
    x: FIELD_CX,
    y: FIELD_CY,
    vx: 0,
    vy: 0,
    spin: 0,
    held: true,
    holdTimer: HOLD_TIME,
    serveSign: drawServeSign(),
    trail: [],
  };
  restBall(ball);
  return ball;
}
