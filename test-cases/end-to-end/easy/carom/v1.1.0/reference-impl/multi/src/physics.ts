// Carom — physics, collision, and the spin mechanic.
//
// One `step()` advances the ball by a fixed dt: it curves the velocity by the
// current spin, decays the spin, then integrates and resolves collisions. To
// guarantee the ball never tunnels through a paddle, wall, or obstacle at high
// speed, the integration is split into sub-steps small enough (<= MAX_SUBSTEP
// px) that the ball center can never skip past an object in one move; collisions
// are resolved after each sub-step. See specs/physics.md.

import {
  BALL_COLLIDE_DIST,
  BALL_R,
  FIELD_H,
  MAX_BOUNCE_ANGLE,
  OBSTACLES,
  PADDLE_HALF,
  SPEED_CAP,
  SPEED_MULT,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
  SPIN_HALFLIFE,
  type Rect,
} from "./constants";
import { clamp, type Ball, type Paddle } from "./entities";
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

function resolveObstacle(ball: Ball, rect: Rect, events: StepEvents): void {
  const hit = collideCircleRect(ball.x, ball.y, BALL_R, rect);
  if (!hit) return;
  // Reflect the velocity component normal to the struck face; push out. Speed
  // and spin are preserved (spin keeps curving the ball after the bounce).
  if (hit.axis === "x") {
    ball.x = hit.place;
    if (ball.vx * hit.normal < 0) ball.vx = -ball.vx;
  } else {
    ball.y = hit.place;
    if (ball.vy * hit.normal < 0) ball.vy = -ball.vy;
  }
  events.obstacle = true;
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

// Spin curves the flight, then decays. Applying spin as a rotation of the
// velocity vector (angular rate = spin / speed) turns the path without changing
// the speed, exactly as a lateral acceleration of magnitude |spin| would.
function applySpin(ball: Ball, dt: number): void {
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
}

// Advance one live ball by `h` and resolve it against the walls, both paddles,
// and both obstacles.
function moveBall(
  ball: Ball,
  left: Paddle,
  right: Paddle,
  h: number,
  events: StepEvents,
): void {
  ball.x += ball.vx * h;
  ball.y += ball.vy * h;
  resolveWalls(ball, events);
  resolvePaddle(ball, left, "left", events);
  resolvePaddle(ball, right, "right", events);
  for (const obs of OBSTACLES) resolveObstacle(ball, obs, events);
}

// Resolve every colliding pair of balls as equal-mass elastic circles. A ball
// held for its countdown is immovable: a moving ball that reaches it simply
// reflects about the contact normal and is pushed clear, while the held ball
// stays put. Spin and speed are unchanged — only the existing velocities are
// redistributed. Two held balls never overlap (their homes are 180px apart).
function resolveBallPairs(balls: Ball[], events: StepEvents): void {
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i];
      const b = balls[j];
      if (a.held && b.held) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= BALL_COLLIDE_DIST || dist <= 1e-9) continue;
      const nx = dx / dist; // unit normal, from a toward b
      const ny = dy / dist;
      const overlap = BALL_COLLIDE_DIST - dist;

      if (!a.held && !b.held) {
        // Equal-mass elastic swap of the normal velocity components; the
        // tangential components are untouched. Then separate the two equally.
        const van = a.vx * nx + a.vy * ny;
        const vbn = b.vx * nx + b.vy * ny;
        const dvn = vbn - van;
        a.vx += dvn * nx;
        a.vy += dvn * ny;
        b.vx -= dvn * nx;
        b.vy -= dvn * ny;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;
      } else {
        // One ball is held (immovable). Reflect the moving one about the
        // contact normal (pointing from the held ball toward it) and push it
        // fully clear.
        const moving = a.held ? b : a;
        const mnx = a.held ? nx : -nx;
        const mny = a.held ? ny : -ny;
        const vn = moving.vx * mnx + moving.vy * mny;
        if (vn < 0) {
          moving.vx -= 2 * vn * mnx;
          moving.vy -= 2 * vn * mny;
        }
        moving.x += mnx * overlap;
        moving.y += mny * overlap;
      }
      events.ball = true;
    }
  }
}

// Advance all three balls one fixed step. Held balls stay put (but remain solid
// for ball-to-ball collision); live balls curve by their own spin, then all are
// integrated in lock-stepped sub-steps small enough that nothing tunnels — the
// walls, paddles, and obstacles are resolved per ball each sub-step, and the
// ball-to-ball pairs are resolved after each sub-step so fast balls cannot pass
// through one another.
export function stepMulti(
  balls: Ball[],
  left: Paddle,
  right: Paddle,
  dt: number,
): StepEvents {
  const events: StepEvents = {
    paddle: false,
    wall: false,
    obstacle: false,
    ball: false,
  };

  let maxSpeed = 0;
  for (const b of balls) {
    if (b.held) continue;
    applySpin(b, dt);
    if (b.speed > maxSpeed) maxSpeed = b.speed;
  }

  const substeps = Math.max(1, Math.ceil((maxSpeed * dt) / MAX_SUBSTEP));
  const h = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    for (const b of balls) {
      if (!b.held) moveBall(b, left, right, h, events);
    }
    resolveBallPairs(balls, events);
  }

  return events;
}
