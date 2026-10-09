// Carom — the plain-data shapes the simulation is written over, and the
// arithmetic on them: the paddles' fixed geometry, the spec's paddle
// integrator, and the ball's derived figures.
//
// The engine's actors CARRY this state (`src/paddle.ts`, `src/ball.ts`,
// `src/scenery.ts`), but the rules themselves are pure functions over these
// records, so the physics in `src/physics.ts`, the obstacle poses in
// `src/obstacles.ts`, the AI in `src/ai.ts`, and the unit tests beside them
// all speak one vocabulary with no world in hand.

import {
  FIELD_CX,
  FIELD_CY,
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  PADDLE_HALF,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  type Rect,
} from "./constants";

/** Which side of the field a paddle or player is on. Player one is the left. */
export type Side = "left" | "right";

/**
 * One paddle, as the physics reads it. `x` is fixed by the side, so only the
 * vertical axis is state; `vy` is the paddle's ACTUAL vertical velocity for the
 * frame — the clamped, integrated one — because that is what the spin mechanic
 * reads at contact.
 */
export interface PaddleSim {
  readonly cy: number;
  readonly vy: number;
}

/**
 * The ball's motion. `spin` is the signed lateral-curvature scalar (magnitude
 * in units per second squared): positive and negative curve the flight opposite
 * ways, it decays by half every SPIN_HALFLIFE seconds, and it changes otherwise
 * only on a paddle hit. `speed` is derived (`hypot(vx, vy)`) and never stored.
 */
export interface BallSim {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly spin: number;
}

/**
 * One obstacle's live pose — where the bar actually is and how far it has
 * turned. This is what the oriented collision in `src/physics.ts` resolves
 * against and what `snapshot().obstacles` reports. The pose is a pure function
 * of the obstacle clock (`src/obstacles.ts`); the `Obstacle` actors carry it on
 * their transforms.
 */
export interface ObstaclePose {
  /** Live center x, in logical pixels. Never moves off the base center's x. */
  readonly cx: number;
  /** Live center y, in logical pixels: the base center swayed by the clock. */
  readonly cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  readonly theta: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The fixed horizontal extent of a side's paddle. */
export function paddleBounds(side: Side): { x0: number; x1: number } {
  return side === "left" ? { x0: P1_X0, x1: P1_X1 } : { x0: P2_X0, x1: P2_X1 };
}

/** The x a side's paddle actor is centered on. */
export function paddleCenterX(side: Side): number {
  const { x0, x1 } = paddleBounds(side);
  return (x0 + x1) / 2;
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
 * The paddle after advancing by its current velocity, clamped fully onto the
 * field — the one integrator every mover of a paddle (input, the AI, and the
 * debug driver) goes through, exactly as specs/playfield.md states it.
 *
 * When the paddle runs into a bound its REAL vertical velocity is its actual
 * (clamped) displacement over `dt`, not the velocity it was asked for — so a
 * paddle pinned against the top or bottom reports zero and imparts no spin even
 * while a movement action is held.
 *
 * A zero-length frame is guarded: a zero step moves nothing and can clamp
 * nothing, and dividing by it would put a NaN into the velocity that drives
 * spin.
 */
export function integratePaddle(paddle: PaddleSim, dt: number): PaddleSim {
  const target = paddle.cy + paddle.vy * dt;
  const clamped = clamp(target, PADDLE_MIN_CY, PADDLE_MAX_CY);
  const vy =
    clamped !== target && dt > 0 ? (clamped - paddle.cy) / dt : paddle.vy;
  return { cy: clamped, vy };
}

/** The ball's current speed: the magnitude of its velocity. Never stored. */
export function ballSpeed(ball: BallSim): number {
  return Math.hypot(ball.vx, ball.vy);
}

/** The ball at its spawn point, motionless and with no spin. */
export function parkedBall(): BallSim {
  return { x: FIELD_CX, y: FIELD_CY, vx: 0, vy: 0, spin: 0 };
}
