// Carom — physics, collision, and the spin mechanic (specs/balls.md).
//
// `step()` advances the ball by one frame's elapsed SECONDS: it curves the
// velocity by the current spin, decays the spin, then integrates and resolves
// collisions. Every rate it uses is per second and is multiplied by `dt`, so the
// same interval of game time reaches the same state however it was divided into
// frames — which is the property the debug API in `src/debug.ts` leans on.
//
// To guarantee the ball never tunnels through a paddle, wall, or obstacle at high
// speed, the integration is split into sub-steps short enough (<= MAX_SUBSTEP units
// of travel) that the ball's center can never skip past an object in one move, and
// collisions are resolved after each sub-step.

import {
  BALL_R,
  FIELD_H,
  MAX_BOUNCE_ANGLE,
  MAX_SUBSTEP,
  OBSTACLES,
  PADDLE_HALF,
  SPEED_CAP,
  SPEED_MULT,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
  SPIN_HALFLIFE,
  type Rect,
} from "./constants";
import { ballSpeed, clamp, paddleFrontX, paddleRect } from "./entities";
import type { BallState, PaddleState, Side } from "./game";

/** What one step's collisions did, so the caller can play a cue per event. */
export interface StepEvents {
  paddle: boolean;
  wall: boolean;
  obstacle: boolean;
}

/**
 * A circle-vs-AABB overlap, by the Minkowski expansion: grow the rectangle by the
 * ball radius and test the ball's center against it. The result is the minimal
 * separating axis, the outward direction along it, and where to place the ball so
 * it rests exactly against that face — or `null` when there is no overlap.
 */
interface Hit {
  axis: "x" | "y";
  /** The direction the ball is pushed out along `axis`. */
  normal: -1 | 1;
  /** The resolved ball-center coordinate on that axis. */
  place: number;
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

/**
 * The signature paddle bounce (specs/balls.md): the outgoing angle comes from the
 * contact point, the speed multiplies once and is capped, and the paddle's own
 * vertical motion at contact imparts spin.
 */
function bounceOffPaddle(
  ball: BallState,
  paddle: PaddleState,
  side: Side,
): void {
  const offset = clamp((ball.y - paddle.cy) / PADDLE_HALF, -1, 1);
  const theta = offset * MAX_BOUNCE_ANGLE;
  const speed = Math.min(ballSpeed(ball) * SPEED_MULT, SPEED_CAP);
  const dir = side === "left" ? 1 : -1; // horizontal, toward the opponent
  ball.vx = dir * speed * Math.cos(theta);
  ball.vy = speed * Math.sin(theta);
  ball.spin = clamp(
    ball.spin + paddle.vy * SPIN_FROM_PADDLE,
    -SPIN_CLAMP,
    SPIN_CLAMP,
  );
  // Placed just off the front face so the same contact cannot re-trigger.
  const front = paddleFrontX(side);
  ball.x = side === "left" ? front + BALL_R : front - BALL_R;
}

function resolvePaddle(
  ball: BallState,
  paddle: PaddleState,
  side: Side,
  events: StepEvents,
): void {
  const hit = collideCircleRect(
    ball.x,
    ball.y,
    BALL_R,
    paddleRect(side, paddle.cy),
  );
  if (!hit) return;
  if (hit.axis === "x") {
    // Front-face contact: the angle, speed, and spin mechanic.
    bounceOffPaddle(ball, paddle, side);
    events.paddle = true;
  } else {
    // The rare hit against a paddle's top or bottom cap: reflect like a wall.
    ball.y = hit.place;
    if (ball.vy * hit.normal < 0) ball.vy = -ball.vy;
    events.wall = true;
  }
}

function resolveObstacle(
  ball: BallState,
  rect: Rect,
  events: StepEvents,
): void {
  const hit = collideCircleRect(ball.x, ball.y, BALL_R, rect);
  if (!hit) return;
  // Reflect the velocity component normal to the struck face and push out. Speed
  // and spin are preserved, so the spin keeps curving the ball after the bounce.
  if (hit.axis === "x") {
    ball.x = hit.place;
    if (ball.vx * hit.normal < 0) ball.vx = -ball.vx;
  } else {
    ball.y = hit.place;
    if (ball.vy * hit.normal < 0) ball.vy = -ball.vy;
  }
  events.obstacle = true;
}

function resolveWalls(ball: BallState, events: StepEvents): void {
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

/** Advance the ball by `dt` seconds and resolve every collision it makes. */
export function step(
  ball: BallState,
  left: PaddleState,
  right: PaddleState,
  dt: number,
): StepEvents {
  const events: StepEvents = { paddle: false, wall: false, obstacle: false };

  // The frame is cut into sub-steps short enough that the ball's center cannot
  // skip past an object in one move. Every part of the step below — the spin, the
  // integration, and the collisions — happens per SUB-step rather than per frame,
  // so the curve the ball actually travels is resolved to MAX_SUBSTEP px however
  // long the frame was. That is what keeps a rally on a 30 Hz display and the same
  // rally on a 240 Hz one landing in the same place.
  const substeps = Math.max(1, Math.ceil((ballSpeed(ball) * dt) / MAX_SUBSTEP));
  const h = dt / substeps;
  // Half the magnitude every SPIN_HALFLIFE seconds. Compounding this per sub-step
  // is exactly the same decay as applying it once over `dt`, because the factors
  // multiply: 0.5^(h/H) taken `substeps` times is 0.5^(dt/H).
  const decay = Math.pow(0.5, h / SPIN_HALFLIFE);

  for (let i = 0; i < substeps; i++) {
    // 1. Spin curves the flight. Rotating the velocity vector at an angular rate
    //    of `spin / speed` turns the path without changing the speed, which is
    //    exactly what a lateral acceleration of magnitude |spin| does.
    const speed = ballSpeed(ball);
    if (speed > 1e-6 && ball.spin !== 0) {
      const dTheta = (ball.spin / speed) * h;
      const c = Math.cos(dTheta);
      const s = Math.sin(dTheta);
      const vx = ball.vx * c - ball.vy * s;
      const vy = ball.vx * s + ball.vy * c;
      ball.vx = vx;
      ball.vy = vy;
    }
    ball.spin *= decay;

    // 2. Advance the position by the elapsed time.
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;

    // 3. Resolve every collision the move could have made.
    resolveWalls(ball, events);
    resolvePaddle(ball, left, "left", events);
    resolvePaddle(ball, right, "right", events);
    for (const obstacle of OBSTACLES) resolveObstacle(ball, obstacle, events);
  }

  return events;
}
