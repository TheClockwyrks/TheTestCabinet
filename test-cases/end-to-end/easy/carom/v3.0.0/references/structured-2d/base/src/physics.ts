// Carom — physics, collision, and the spin mechanic (specs/balls.md).
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
// and the unit tests drive it directly. The obstacle rectangles are a
// parameter rather than a read of `OBSTACLES`, so a caller passes the fixed
// pair this variant plays against.
//
// Nothing here writes to the ball it is handed. Each stage takes a ball and the
// events so far and returns the ball after it and the events including its own,
// and `step` threads that pair through the sub-steps.

import {
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
  paddleFrontX,
  paddleRect,
  type BallSim,
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
 * overlap.
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

function resolveObstacle({ ball, events }: Flight, rect: Rect): Flight {
  const hit = collideCircleRect(ball.x, ball.y, BALL_R, rect);
  if (!hit) return { ball, events };
  // Reflect the velocity component normal to the struck face and push out.
  // Speed and spin are preserved, so the spin keeps curving the ball after the
  // bounce.
  return { ball: reflect(ball, hit), events: { ...events, obstacle: true } };
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
  obstacles: readonly Rect[],
  h: number,
  decay: number,
): Flight {
  // 1. Spin curves the flight, and decays.
  const curved = curve(flight.ball, h);
  const spun = { ...curved, spin: curved.spin * decay };

  // 2. Advance the position by the elapsed time.
  const moved = { ...spun, x: spun.x + spun.vx * h, y: spun.y + spun.vy * h };

  // 3. Resolve every collision the move could have made, in the fixed order:
  //    the walls, the left paddle, the right paddle, then each obstacle.
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
  obstacles: readonly Rect[],
  dt: number,
): Flight {
  // The frame is cut into sub-steps short enough that the ball's center cannot
  // skip past an object in one move. Every part of the step — the spin, the
  // integration, and the collisions — happens per SUB-step rather than per
  // frame, so the curve the ball actually travels is resolved to MAX_SUBSTEP px
  // however long the frame was. That is what keeps a rally on a 30 Hz display
  // and the same rally on a 240 Hz one landing in the same place.
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
