// Carom (Gyre) — physics, collision, and the spin mechanic (specs/balls.md,
// specs/playfield.md).
//
// `step()` advances the ball by one frame's elapsed SECONDS: it curves the
// velocity by the current spin, decays the spin, then integrates and resolves
// collisions. Every rate it uses is per second and is multiplied by `dt`, so
// the same interval of game time reaches the same state however it was divided
// into frames — which is the property the debug surface in `src/debug.ts`
// leans on.
//
// To guarantee the ball never tunnels through a paddle, wall, or obstacle at
// high speed, the integration is split into sub-steps short enough
// (<= MAX_SUBSTEP units of travel) that the ball's center can never skip past
// an object in one move, and collisions are resolved after each sub-step.
//
// This module is deliberately engine-free: it is pure arithmetic over the
// records `src/sim.ts` declares, so the `Ball` actor drives it from its tick
// and the unit tests drive it directly. The obstacles are a parameter — their
// LIVE poses, center and angle, read off the `Obstacle` actors at the moment
// of the step — because in this variant the pair sways and rotates and there
// is no fixed rectangle to close over.
//
// Nothing here writes to the ball it is handed. Each stage takes a ball and the
// events so far and returns the ball after it and the events including its own,
// and `step` threads that pair through the sub-steps.

import {
  BALL_R,
  FIELD_H,
  MAX_BOUNCE_ANGLE,
  MAX_SUBSTEP,
  OBSTACLE_HH,
  OBSTACLE_HW,
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
  paddleFrontX,
  paddleRect,
  type BallSim,
  type ObstaclePose,
  type PaddleSim,
  type Side,
} from "./sim";

/** What one step's collisions did, so the caller can play a cue per event. */
export interface StepEvents {
  readonly paddle: boolean;
  readonly wall: boolean;
  readonly obstacle: boolean;
}

/** The ball after a stage of the step, and the events up to and including it. */
export interface Flight {
  readonly ball: BallSim;
  readonly events: StepEvents;
}

/**
 * A circle-vs-AABB overlap, by the Minkowski expansion: grow the rectangle by
 * the ball radius and test the ball's center against it. The result is the
 * minimal separating axis, the outward direction along it, and where to place
 * the ball so it rests exactly against that face — or `null` when there is no
 * overlap. The paddles are resolved this way; an obstacle, which is oriented,
 * has its own resolution below.
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
 * The signature paddle bounce (specs/balls.md): the outgoing angle comes from
 * the contact point, the speed multiplies once and is capped, and the paddle's
 * own vertical motion at contact imparts spin.
 */
function bounceOffPaddle(
  ball: BallSim,
  paddle: PaddleSim,
  side: Side,
): BallSim {
  const offset = clamp((ball.y - paddle.cy) / PADDLE_HALF, -1, 1);
  const theta = offset * MAX_BOUNCE_ANGLE;
  const speed = Math.min(ballSpeed(ball) * SPEED_MULT, SPEED_CAP);
  const dir = side === "left" ? 1 : -1; // horizontal, toward the opponent
  // Placed just off the front face so the same contact cannot re-trigger.
  const front = paddleFrontX(side);
  return {
    x: side === "left" ? front + BALL_R : front - BALL_R,
    y: ball.y,
    vx: dir * speed * Math.cos(theta),
    vy: speed * Math.sin(theta),
    spin: clamp(
      ball.spin + paddle.vy * SPIN_FROM_PADDLE,
      -SPIN_CLAMP,
      SPIN_CLAMP,
    ),
  };
}

/** The ball reflected off the struck face on `axis`, and pushed out to `place`. */
function reflect(ball: BallSim, hit: Hit): BallSim {
  if (hit.axis === "x") {
    const vx = ball.vx * hit.normal < 0 ? -ball.vx : ball.vx;
    return { ...ball, x: hit.place, vx };
  }
  const vy = ball.vy * hit.normal < 0 ? -ball.vy : ball.vy;
  return { ...ball, y: hit.place, vy };
}

function resolvePaddle(
  { ball, events }: Flight,
  paddle: PaddleSim,
  side: Side,
): Flight {
  const hit = collideCircleRect(
    ball.x,
    ball.y,
    BALL_R,
    paddleRect(side, paddle.cy),
  );
  if (!hit) return { ball, events };
  if (hit.axis === "x") {
    // Front-face contact: the angle, speed, and spin mechanic.
    return {
      ball: bounceOffPaddle(ball, paddle, side),
      events: { ...events, paddle: true },
    };
  }
  // The rare hit against a paddle's top or bottom cap: reflect like a wall.
  return { ball: reflect(ball, hit), events: { ...events, wall: true } };
}

/**
 * Resolve the ball against ONE ORIENTED obstacle (specs/playfield.md).
 *
 * The obstacle is a rectangle of half-extents (OBSTACLE_HW, OBSTACLE_HH)
 * turned by `theta` about its live center, so there is no world axis to
 * reflect about. The work is done in the obstacle's own frame, where it IS
 * axis-aligned, and only the contact normal is carried back out to the world:
 *
 *   1. Un-rotate the ball's center about the obstacle's center by -theta.
 *   2. Clamp to the rectangle for the closest point, and overlap when the
 *      distance to it is under BALL_R.
 *   3. The local normal is the direction from that closest point to the ball —
 *      a face normal on an edge hit, a corner direction on a corner hit — or,
 *      for a center that has ended up INSIDE, the axis of least penetration.
 *   4. Rotate the normal back by +theta.
 *   5. Reflect the velocity about it if the ball is moving inward, then place
 *      the ball exactly BALL_R off the contact point along it.
 *
 * At theta = 0 this reduces to the upright case: a vertical face flips `vx`, a
 * horizontal one flips `vy`. Speed and spin are untouched, so the spin keeps
 * curving the ball after the bounce, and the obstacle's own motion changes
 * only WHERE and at what angle the ball is struck.
 */
function resolveObstacle(
  { ball, events }: Flight,
  obstacle: ObstaclePose,
): Flight {
  const cos = Math.cos(obstacle.theta);
  const sin = Math.sin(obstacle.theta);
  const dx = ball.x - obstacle.cx;
  const dy = ball.y - obstacle.cy;
  // Into the obstacle's local axes.
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;

  const qx = clamp(lx, -OBSTACLE_HW, OBSTACLE_HW);
  const qy = clamp(ly, -OBSTACLE_HH, OBSTACLE_HH);
  const ox = lx - qx;
  const oy = ly - qy;
  const dist2 = ox * ox + oy * oy;
  const inside = dist2 === 0;

  let nlx: number;
  let nly: number;
  if (inside) {
    // The center is within the rectangle: leave along whichever face is
    // nearest, which is the shallowest way out.
    const exX = OBSTACLE_HW - Math.abs(lx);
    const exY = OBSTACLE_HH - Math.abs(ly);
    if (exX <= exY) {
      nlx = lx >= 0 ? 1 : -1;
      nly = 0;
    } else {
      nlx = 0;
      nly = ly >= 0 ? 1 : -1;
    }
  } else {
    if (dist2 >= BALL_R * BALL_R) return { ball, events };
    const dist = Math.sqrt(dist2);
    nlx = ox / dist;
    nly = oy / dist;
  }

  // Back to world axes.
  const nx = nlx * cos - nly * sin;
  const ny = nlx * sin + nly * cos;

  // Reflect only when the ball is actually moving into the surface, so a ball
  // already leaving is not caught and turned back around.
  const vn = ball.vx * nx + ball.vy * ny;
  const vx = vn < 0 ? ball.vx - 2 * vn * nx : ball.vx;
  const vy = vn < 0 ? ball.vy - 2 * vn * ny : ball.vy;

  // Place the center exactly BALL_R off the contact point along the normal.
  const contactX = obstacle.cx + (qx * cos - qy * sin);
  const contactY = obstacle.cy + (qx * sin + qy * cos);
  return {
    ball: {
      x: contactX + nx * BALL_R,
      y: contactY + ny * BALL_R,
      vx,
      vy,
      spin: ball.spin,
    },
    events: { ...events, obstacle: true },
  };
}

function resolveWalls({ ball, events }: Flight): Flight {
  if (ball.y - BALL_R < 0 && ball.vy < 0) {
    return {
      ball: { ...ball, y: BALL_R, vy: -ball.vy },
      events: { ...events, wall: true },
    };
  }
  if (ball.y + BALL_R > FIELD_H && ball.vy > 0) {
    return {
      ball: { ...ball, y: FIELD_H - BALL_R, vy: -ball.vy },
      events: { ...events, wall: true },
    };
  }
  return { ball, events };
}

/**
 * The ball with its velocity turned by the spin over one sub-step of `h`
 * seconds.
 *
 * Rotating the velocity vector at an angular rate of `spin / speed` turns the
 * path without changing the speed, which is exactly what a lateral acceleration
 * of magnitude |spin| does.
 */
function curve(ball: BallSim, h: number): BallSim {
  const speed = ballSpeed(ball);
  if (!(speed > 1e-6 && ball.spin !== 0)) return ball;
  const dTheta = (ball.spin / speed) * h;
  const c = Math.cos(dTheta);
  const s = Math.sin(dTheta);
  return {
    ...ball,
    vx: ball.vx * c - ball.vy * s,
    vy: ball.vx * s + ball.vy * c,
  };
}

/** One sub-step: curve, decay, advance, then resolve every collision. */
function substep(
  flight: Flight,
  left: PaddleSim,
  right: PaddleSim,
  obstacles: readonly ObstaclePose[],
  h: number,
  decay: number,
): Flight {
  // 1. Spin curves the flight, and decays.
  const curved = curve(flight.ball, h);
  const spun = { ...curved, spin: curved.spin * decay };

  // 2. Advance the position by the elapsed time.
  const moved = { ...spun, x: spun.x + spun.vx * h, y: spun.y + spun.vy * h };

  // 3. Resolve every collision the move could have made, in the fixed order:
  //    the walls, the left paddle, the right paddle, then each obstacle at its
  //    live pose.
  const afterWalls = resolveWalls({ ball: moved, events: flight.events });
  const afterLeft = resolvePaddle(afterWalls, left, "left");
  const afterRight = resolvePaddle(afterLeft, right, "right");
  return obstacles.reduce(resolveObstacle, afterRight);
}

/** The ball after `dt` seconds of flight, with every collision it made resolved. */
export function step(
  ball: BallSim,
  left: PaddleSim,
  right: PaddleSim,
  obstacles: readonly ObstaclePose[],
  dt: number,
): Flight {
  // The frame is cut into sub-steps short enough that the ball's center cannot
  // skip past an object in one move. Every part of the step — the spin, the
  // integration, and the collisions — happens per SUB-step rather than per
  // frame, so the curve the ball actually travels is resolved to MAX_SUBSTEP px
  // however long the frame was. That is what keeps a rally on a 30 Hz display
  // and the same rally on a 240 Hz one landing in the same place. (The
  // obstacles hold their pose for the frame: theirs is the frame's settled
  // clock, wound before the ball ticks.)
  const substeps = Math.max(1, Math.ceil((ballSpeed(ball) * dt) / MAX_SUBSTEP));
  const h = dt / substeps;
  // Half the magnitude every SPIN_HALFLIFE seconds. Compounding this per
  // sub-step is exactly the same decay as applying it once over `dt`, because
  // the factors multiply: 0.5^(h/H) taken `substeps` times is 0.5^(dt/H).
  const decay = Math.pow(0.5, h / SPIN_HALFLIFE);

  let flight: Flight = {
    ball,
    events: { paddle: false, wall: false, obstacle: false },
  };
  for (let i = 0; i < substeps; i++) {
    flight = substep(flight, left, right, obstacles, h, decay);
  }
  return flight;
}
