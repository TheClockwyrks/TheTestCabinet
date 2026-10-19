// Carom — physics, collision, and the spin mechanic.
//
// One `step()` advances the ball by a fixed dt: it curves the velocity by the
// current spin, decays the spin, then integrates and resolves collisions. To
// guarantee the ball never tunnels through a paddle, wall, or obstacle at high
// speed, the integration is split into sub-steps small enough (<= MAX_SUBSTEP
// px) that the ball center can never skip past an object in one move; collisions
// are resolved after each sub-step. See specs/physics.md.

import {
  BALL_R,
  FIELD_H,
  MAX_BOUNCE_ANGLE,
  PADDLE_HALF,
  SPEED_CAP,
  SPEED_MULT,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
  SPIN_HALFLIFE,
  type Rect,
} from "./constants";
import { clamp, type Ball, type Paddle } from "./entities";
import { OBSTACLE_COUNT, obstaclePose, resolveObstaclePose } from "./obstacles";
import type { Side, StepEvents } from "./types";

const MAX_SUBSTEP = 4; // px of travel per collision sub-step

// A circle-vs-AABB overlap test using the Minkowski expansion (grow the rect by
// the ball radius, test the ball center against it). Returns the minimal
// separating axis, the outward normal direction, and where to place the ball so
// it rests exactly against that face — or null when there is no overlap.
interface Hit {
  axis: "x" | "y";
  normal: -1 | 1; // direction to push the ball out along `axis`
  place: number; // resolved ball center coordinate on that axis
}

function collideCircleRect(
  bx: number,
  by: number,
  r: number,
  rect: Rect,
): Hit | null {
  const exLeft = bx - (rect.x0 - r);
  const exRight = rect.x1 + r - bx;
  const exTop = by - (rect.y0 - r);
  const exBottom = rect.y1 + r - by;
  if (exLeft <= 0 || exRight <= 0 || exTop <= 0 || exBottom <= 0) return null;

  const min = Math.min(exLeft, exRight, exTop, exBottom);
  if (min === exLeft) return { axis: "x", normal: -1, place: rect.x0 - r };
  if (min === exRight) return { axis: "x", normal: 1, place: rect.x1 + r };
  if (min === exTop) return { axis: "y", normal: -1, place: rect.y0 - r };
  return { axis: "y", normal: 1, place: rect.y1 + r };
}

function paddleRect(p: Paddle): Rect {
  return { x0: p.x0, y0: p.cy - PADDLE_HALF, x1: p.x1, y1: p.cy + PADDLE_HALF };
}

// The signature paddle bounce: reflection angle from the contact point, a small
// speed multiply capped at SPEED_CAP, and spin imparted by the paddle's motion.
function bounceOffPaddle(ball: Ball, p: Paddle, side: Side): void {
  const offset = clamp((ball.y - p.cy) / PADDLE_HALF, -1, 1);
  const theta = offset * MAX_BOUNCE_ANGLE;
  const speed = Math.min(ball.speed * SPEED_MULT, SPEED_CAP);
  const dir = side === "left" ? 1 : -1; // horizontal, toward the opponent
  ball.vx = dir * speed * Math.cos(theta);
  ball.vy = speed * Math.sin(theta);
  ball.spin = clamp(ball.spin + p.vy * SPIN_FROM_PADDLE, -SPIN_CLAMP, SPIN_CLAMP);
  // Place the ball just off the front face so it cannot re-trigger.
  ball.x = side === "left" ? p.frontX + BALL_R : p.frontX - BALL_R;
}

function resolvePaddle(
  ball: Ball,
  p: Paddle,
  side: Side,
  events: StepEvents,
): void {
  const hit = collideCircleRect(ball.x, ball.y, BALL_R, paddleRect(p));
  if (!hit) return;
  if (hit.axis === "x") {
    // Front-face contact: apply the spin/angle mechanic.
    bounceOffPaddle(ball, p, side);
    events.paddle = true;
  } else {
    // A rare hit against the rounded top/bottom cap: reflect like a wall.
    ball.y = hit.place;
    if (ball.vy * hit.normal < 0) ball.vy = -ball.vy;
    events.wall = true;
  }
}

function resolveWalls(ball: Ball, events: StepEvents): void {
  if (ball.y - BALL_R < 0 && ball.vy < 0) {
    ball.y = BALL_R;
    ball.vy = -ball.vy;
    events.wall = true;
  } else if (ball.y + BALL_R > FIELD_H && ball.vy > 0) {
    ball.y = FIELD_H - BALL_R;
    ball.vy = -ball.vy;
    events.wall = true;
  }
}

// `obsTime` is the obstacle clock (seconds) at the start of this step; the
// obstacles advance across the sub-steps, so each obstacle's pose is sampled at
// the sub-step's own time — a fast ball cannot pass through a thin, tilted,
// moving obstacle between samples. See specs/obstacles.md.
export function step(
  ball: Ball,
  left: Paddle,
  right: Paddle,
  dt: number,
  obsTime: number,
): StepEvents {
  const events: StepEvents = { paddle: false, wall: false, obstacle: false };

  // 1. Spin curves the flight. Applying spin as a rotation of the velocity
  //    vector (angular rate = spin / speed) turns the path without changing the
  //    speed, exactly as a lateral acceleration of magnitude |spin| would.
  const speed = ball.speed;
  if (speed > 1e-6 && ball.spin !== 0) {
    const dTheta = (ball.spin / speed) * dt;
    const c = Math.cos(dTheta);
    const s = Math.sin(dTheta);
    const vx = ball.vx * c - ball.vy * s;
    const vy = ball.vx * s + ball.vy * c;
    ball.vx = vx;
    ball.vy = vy;
  }
  // Spin decays exponentially: half its magnitude every SPIN_HALFLIFE seconds.
  ball.spin *= Math.pow(0.5, dt / SPIN_HALFLIFE);

  // 2 + 3. Integrate in small sub-steps, resolving collisions after each.
  const substeps = Math.max(1, Math.ceil((ball.speed * dt) / MAX_SUBSTEP));
  const h = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    resolveWalls(ball, events);
    resolvePaddle(ball, left, "left", events);
    resolvePaddle(ball, right, "right", events);
    // Sample each obstacle at this sub-step's time so the moving, rotating
    // obstacle is resolved against the ball at the pose it actually has here.
    const tSub = obsTime + (i + 1) * h;
    for (let o = 0; o < OBSTACLE_COUNT; o++) {
      resolveObstaclePose(ball, obstaclePose(o, tSub), events);
    }
  }

  return events;
}
