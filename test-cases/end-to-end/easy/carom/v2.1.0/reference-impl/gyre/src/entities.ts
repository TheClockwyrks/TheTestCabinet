// Carom — the movable objects in the field: paddles and the ball.
// Obstacles are static rectangles and live in `constants.ts`.

import {
  BALL_R,
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  PADDLE_HALF,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
} from "./constants";
import type { Side } from "./types";

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class Paddle {
  readonly side: Side;
  readonly x0: number; // left edge
  readonly x1: number; // right edge
  readonly frontX: number; // the field-facing face
  cy: number; // center y
  vy = 0; // current vertical velocity (-speed, 0, +speed); drives spin

  constructor(side: Side) {
    this.side = side;
    if (side === "left") {
      this.x0 = P1_X0;
      this.x1 = P1_X1;
      this.frontX = P1_X1;
    } else {
      this.x0 = P2_X0;
      this.x1 = P2_X1;
      this.frontX = P2_X0;
    }
    this.cy = 360;
  }

  get top(): number {
    return this.cy - PADDLE_HALF;
  }
  get bottom(): number {
    return this.cy + PADDLE_HALF;
  }

  // Advance by the current velocity and clamp fully onto the field. When the
  // paddle runs into the top/bottom bound, its real vertical velocity is its
  // actual (clamped) displacement over dt, not the held input velocity — so a
  // paddle pinned against a bound is stationary and imparts no spin even while a
  // movement key is held (see the spin mechanic in physics.md).
  integrate(dt: number): void {
    const target = this.cy + this.vy * dt;
    const clamped = clamp(target, PADDLE_MIN_CY, PADDLE_MAX_CY);
    if (clamped !== target) this.vy = (clamped - this.cy) / dt;
    this.cy = clamped;
  }
}

export class Ball {
  x = 640;
  y = 360;
  vx = 0;
  vy = 0;
  spin = 0; // signed lateral-curvature scalar (px/s^2 magnitude)

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  // Park the ball at the center, motionless (pre-serve hold).
  hold(): void {
    this.x = 640;
    this.y = 360;
    this.vx = 0;
    this.vy = 0;
    this.spin = 0;
  }

  radius(): number {
    return BALL_R;
  }
}
