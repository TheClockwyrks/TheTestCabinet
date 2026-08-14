// Carom — the movable objects in the field: paddles and the ball.
// Obstacles are static rectangles and live in `constants.ts`.

import {
  BALL_R,
  HOLD_TIME,
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  PADDLE_HALF,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  SERVE_SPEED,
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

// One of the three balls. Each carries its own velocity and its own spin, its
// own fixed home point, and its own countdown — it is an independent contest.
export class Ball {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  spin = 0; // signed lateral-curvature scalar (px/s^2 magnitude)

  readonly hx: number; // home point x
  readonly hy: number; // home point y
  // Where this ball stood when the current step began. The renderer draws
  // between that and the current position (see Game.renderAlpha), so motion is
  // smooth even though the simulation moves in whole fixed steps. Written by
  // the step, read by the renderer, never the reverse.
  prevX: number;
  prevY: number;
  held = false; // parked solid at the home point, counting down
  holdTimer = 0; // seconds remaining on this ball's own countdown

  constructor(hx: number, hy: number) {
    this.hx = hx;
    this.hy = hy;
    this.x = hx;
    this.y = hy;
    this.prevX = hx;
    this.prevY = hy;
  }

  viewX(alpha: number): number {
    return lerp(this.prevX, this.x, alpha);
  }
  viewY(alpha: number): number {
    return lerp(this.prevY, this.y, alpha);
  }

  // Collapse the interpolation window onto the current position, so a ball that
  // is repositioned rather than integrated is not drawn smearing across the jump.
  syncView(): void {
    this.prevX = this.x;
    this.prevY = this.y;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  // Return to this ball's own home point and begin a fresh countdown, held
  // solid and motionless until it elapses.
  parkHome(): void {
    this.x = this.hx;
    this.y = this.hy;
    this.vx = 0;
    this.vy = 0;
    this.spin = 0;
    this.held = true;
    this.holdTimer = HOLD_TIME;
    this.syncView();
  }

  // Launch from the home point at the given absolute angle (radians), at the
  // serve speed, with no carried spin.
  launch(angle: number): void {
    this.x = this.hx;
    this.y = this.hy;
    this.spin = 0;
    this.vx = SERVE_SPEED * Math.cos(angle);
    this.vy = SERVE_SPEED * Math.sin(angle);
    this.held = false;
    this.holdTimer = 0;
    this.syncView();
  }

  radius(): number {
    return BALL_R;
  }
}
