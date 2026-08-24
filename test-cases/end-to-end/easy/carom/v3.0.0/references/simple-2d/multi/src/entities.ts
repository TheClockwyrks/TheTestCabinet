// Carom — the movable objects in the field: the paddles and the three balls.
//
// Both live in `CaromState` as plain data (`src/game.ts`), so this module holds no
// state of its own: it is the arithmetic over those records, plus the fixed
// geometry each side's paddle occupies. Every function here takes a record and
// returns a new one; none writes to what it is handed. The obstacles are static
// and are named in `src/constants.ts`.

import {
  BALL_COUNT,
  BALL_HOMES,
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
 * A zero-length frame is guarded: a zero step moves nothing and can clamp nothing,
 * and dividing by it would put a NaN into the velocity that drives spin.
 */
export function integratePaddle(paddle: PaddleState, dt: number): PaddleState {
  const target = paddle.cy + paddle.vy * dt;
  const clamped = clamp(target, PADDLE_MIN_CY, PADDLE_MAX_CY);
  const vy =
    clamped !== target && dt > 0 ? (clamped - paddle.cy) / dt : paddle.vy;
  return { cy: clamped, vy };
}

/** The ball's current speed: the magnitude of its velocity. Never stored. */
export function ballSpeed(ball: Pick<BallState, "vx" | "vy">): number {
  return Math.hypot(ball.vx, ball.vy);
}

/**
 * Ball `index` parked on its OWN home point: motionless, spinless, and with an
 * empty trail.
 *
 * `hold` is the wait it starts there. A positive `hold` leaves the ball waiting
 * and solid until that many seconds have passed; `0` leaves it parked and unheld,
 * which is the title screen's pose and no part of a live match. Every field is
 * fixed by the home and the hold, so nothing of the ball's previous state is
 * needed to build it.
 */
export function parkBall(index: number, hold: number): BallState {
  const home = BALL_HOMES[index];
  return {
    x: home.x,
    y: home.y,
    vx: 0,
    vy: 0,
    spin: 0,
    held: hold > 0,
    holdTimer: hold,
    trail: [],
  };
}

/** The three balls, in play order, each parked on its own home point. */
export function createBalls(): BallState[] {
  return BALL_HOMES.slice(0, BALL_COUNT).map((_home, index) =>
    parkBall(index, 0),
  );
}
