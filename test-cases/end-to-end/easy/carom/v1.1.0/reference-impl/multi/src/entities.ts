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

  // Advance by the current velocity and clamp fully onto the field.
  integrate(dt: number): void {
    this.cy = clamp(this.cy + this.vy * dt, PADDLE_MIN_CY, PADDLE_MAX_CY);
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
  held = false; // parked solid at the home point, counting down
  holdTimer = 0; // seconds remaining on this ball's own countdown

  constructor(hx: number, hy: number) {
    this.hx = hx;
    this.hy = hy;
    this.x = hx;
    this.y = hy;
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
  }

  radius(): number {
    return BALL_R;
  }
}
