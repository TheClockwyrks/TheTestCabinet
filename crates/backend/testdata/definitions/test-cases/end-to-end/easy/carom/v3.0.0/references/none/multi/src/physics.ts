// Carom — physics, collision, and the spin mechanic (specs/balls.md).
//
// `step()` advances every ball by one frame's elapsed SECONDS: each curves by its
// own spin, decays that spin, then integrates and resolves its collisions, and the
// balls are finally resolved against one another. Every rate it uses is per second
// and is multiplied by `dt`, so the same interval of game time reaches the same
// state however it was divided into frames — which is the property the debug API
// in `src/debug.ts` leans on.
//
// WHICH BALLS AND WHICH OBSTACLES TAKE PART IS THE CALLER'S. Both arrive as the
// bodies PRESENT on the field (specs/state.md), so a ball that has been removed
// takes no sub-step and an obstacle that has been removed has no collision — the
// field simply does not contain them.
//
// To guarantee no ball tunnels through a paddle, wall, obstacle, or another ball
// at high speed, the integration is split into sub-steps short enough
// (<= MAX_SUBSTEP units of travel) that a ball's center can never skip past an
// object in one move. The three balls advance in LOCK STEP through those
// sub-steps, so a pair closing head-on is resolved at the sub-step they meet
// rather than after one of them has crossed the other.

import {
  BALL_COLLIDE_DIST,
  BALL_R,
  FIELD_H,
  MAX_BOUNCE_ANGLE,
  MAX_SUBSTEP,
  PADDLE_HALF,
  SPEED_CAP,
  SPEED_MULT,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
  SPIN_HALFLIFE,
  type Rect,
} from "./constants";
import {
  ballSpeed,
  clamp,
  obstacleRect,
  paddleFrontX,
  paddleRect,
} from "./entities";
import type { BallState, ObstacleState, PaddleState, Side } from "./game";

/** What one step's collisions did, so the caller can play a cue per event. */
export interface StepEvents {
  paddle: boolean;
  wall: boolean;
  obstacle: boolean;
  /** A ball struck another ball. */
  ball: boolean;
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

/**
 * Resolve every pair of balls in contact, as elastic circles of equal mass.
 *
 * A ball waiting at its home point is IMMOVABLE: the moving ball reflects about
 * the contact normal and is pushed clear while the waiting ball keeps its place
 * and its hold timer, which is what makes a ball counting down a solid obstacle
 * rather than a ghost. Neither ball's spin changes, and no speed is created — the
 * velocities the two balls already carry are only redistributed.
 */
function resolveBallPairs(balls: BallState[], events: StepEvents): void {
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i];
      const b = balls[j];
      if (a.held && b.held) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= BALL_COLLIDE_DIST || dist <= 1e-9) continue;

      const nx = dx / dist; // the unit normal, from a toward b
      const ny = dy / dist;
      const overlap = BALL_COLLIDE_DIST - dist;

      if (a.held || b.held) {
        // One of them is immovable. Reflect the other about the contact normal,
        // pointing out of the waiting ball, and push it fully clear.
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
      } else {
        // Equal masses: exchange the components along the normal and leave the
        // tangential components alone, then separate the pair equally.
        const van = a.vx * nx + a.vy * ny;
        const vbn = b.vx * nx + b.vy * ny;
        const exchange = vbn - van;
        a.vx += exchange * nx;
        a.vy += exchange * ny;
        b.vx -= exchange * nx;
        b.vy -= exchange * ny;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;
      }
      events.ball = true;
    }
  }
}

/** Advance one ball through a single sub-step and resolve what it strikes. */
function substepBall(
  ball: BallState,
  obstacles: readonly ObstacleState[],
  left: PaddleState,
  right: PaddleState,
  h: number,
  decay: number,
  events: StepEvents,
): void {
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

  // 3. Resolve every collision the move could have made. The other balls come
  //    afterward, once every ball has taken this sub-step.
  resolveWalls(ball, events);
  resolvePaddle(ball, left, "left", events);
  resolvePaddle(ball, right, "right", events);
  // Only the obstacles PRESENT in the field: one taken off it has no collision
  // at all (specs/instrumentation.md).
  for (const obstacle of obstacles) {
    resolveObstacle(ball, obstacleRect(obstacle), events);
  }
}

/** Advance every ball by `dt` seconds and resolve every collision they make. */
export function step(
  balls: BallState[],
  obstacles: readonly ObstacleState[],
  left: PaddleState,
  right: PaddleState,
  dt: number,
): StepEvents {
  const events: StepEvents = {
    paddle: false,
    wall: false,
    obstacle: false,
    ball: false,
  };

  // The frame is cut into sub-steps short enough that no ball's center can skip
  // past an object in one move, sized by the FASTEST ball so every ball shares the
  // same sub-step clock. Every part of the step below — the spin, the integration,
  // and the collisions — happens per SUB-step rather than per frame, so the curve
  // each ball actually travels is resolved to MAX_SUBSTEP units however long the
  // frame was. That is what keeps a rally on a 30 Hz display and the same rally on
  // a 240 Hz one landing in the same place.
  let fastest = 0;
  for (const ball of balls) {
    if (ball.held) continue;
    const speed = ballSpeed(ball);
    if (speed > fastest) fastest = speed;
  }
  const substeps = Math.max(1, Math.ceil((fastest * dt) / MAX_SUBSTEP));
  const h = dt / substeps;
  // Half the magnitude every SPIN_HALFLIFE seconds. Compounding this per sub-step
  // is exactly the same decay as applying it once over `dt`, because the factors
  // multiply: 0.5^(h/H) taken `substeps` times is 0.5^(dt/H).
  const decay = Math.pow(0.5, h / SPIN_HALFLIFE);

  for (let i = 0; i < substeps; i++) {
    for (const ball of balls) {
      if (ball.held) continue;
      substepBall(ball, obstacles, left, right, h, decay, events);
    }
    resolveBallPairs(balls, events);
  }

  return events;
}
