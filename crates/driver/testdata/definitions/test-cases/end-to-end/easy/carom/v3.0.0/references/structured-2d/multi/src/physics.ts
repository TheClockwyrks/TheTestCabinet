// Carom — physics, collision, and the spin mechanic (specs/balls.md).
//
// `step()` advances every ball in flight by one frame's elapsed SECONDS: each
// curves by its own spin, decays that spin, then integrates and resolves its
// collisions, and the balls are finally resolved against one another. Every
// rate it uses is per second and is multiplied by `dt`, so the same interval of
// game time reaches the same state however it was divided into frames — which
// is the property the debug surface in `src/debug.ts` leans on.
//
// To guarantee no ball tunnels through a paddle, wall, obstacle, or another
// ball at high speed, the integration is split into sub-steps short enough
// (<= MAX_SUBSTEP units of travel) that a ball's center can never skip past an
// object in one move. The sub-step count comes from the FASTEST ball in flight,
// and the balls advance in LOCK STEP through those sub-steps, so a pair closing
// head-on is resolved at the sub-step they meet rather than after one of them
// has crossed the other. A held ball takes no sub-steps of its own: it is an
// immovable solid the pair resolution bounces a moving ball off.
//
// This module is deliberately engine-free: it is pure arithmetic over the
// records `src/sim.ts` declares, so the `Rally` actor drives it from its tick
// and the unit tests drive it directly. The obstacle rectangles are a parameter
// rather than a read of `OBSTACLES`, so a caller passes the fixed pair this
// variant plays against.
//
// Nothing here writes to a ball it is handed. Each stage takes a ball and the
// events so far and returns the ball after it and the events including its own,
// and `step` threads that pair through the sub-steps and returns the advanced
// set beside the events of the whole frame.

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
  paddleFrontX,
  paddleRect,
  type BallSim,
  type PaddleSim,
  type RallyBall,
  type Side,
} from "./sim";

/** What one step's collisions did, so the caller can play a cue per event. */
export interface StepEvents {
  readonly paddle: boolean;
  readonly wall: boolean;
  readonly obstacle: boolean;
  /** A ball struck another ball. One event per pair, not per ball. */
  readonly ball: boolean;
}

/** One ball after a stage of the step, and the events up to and including it. */
export interface Flight {
  readonly ball: BallSim;
  readonly events: StepEvents;
}

/** What `step()` returns: every ball after the frame, and what they struck. */
export interface RallyStep {
  readonly balls: readonly RallyBall[];
  readonly events: StepEvents;
}

const NO_EVENTS: StepEvents = {
  paddle: false,
  wall: false,
  obstacle: false,
  ball: false,
};

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

/** One ball's sub-step: curve, decay, advance, then resolve the field. */
function substepBall(
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
  //    the walls, the left paddle, the right paddle, then each obstacle. The
  //    other balls come afterward, once every ball has taken this sub-step.
  const afterWalls = resolveWalls({ ball: moved, events: flight.events });
  const afterLeft = resolvePaddle(afterWalls, left, "left");
  const afterRight = resolvePaddle(afterLeft, right, "right");
  return obstacles.reduce(resolveObstacle, afterRight);
}

/**
 * Every pair of balls in contact resolved, as elastic circles of equal mass
 * (specs/balls.md).
 *
 * A ball waiting at its home point is IMMOVABLE: the moving ball reflects about
 * the contact normal and is pushed fully clear while the waiting ball keeps its
 * place, which is what makes a ball counting its hold down a solid body rather
 * than a ghost. Neither ball's spin changes, and no speed is created — the
 * velocities the two balls already carry are only redistributed.
 *
 * Pairs are resolved in index order, each against the balls as the pairs
 * before it left them, so `out` is the working copy the resolutions are
 * written through.
 */
function resolveBallPairs(
  balls: readonly RallyBall[],
  events: StepEvents,
): RallyStep {
  const out = [...balls];
  let struck = false;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      if (a.held && b.held) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= BALL_COLLIDE_DIST || dist <= 1e-9) continue;

      const nx = dx / dist; // the unit normal, from a toward b
      const ny = dy / dist;
      const overlap = BALL_COLLIDE_DIST - dist;

      if (a.held || b.held) {
        // One of them is immovable. Reflect the other about the contact
        // normal, pointing out of the waiting ball, and push it fully clear.
        const moving = a.held ? b : a;
        const mnx = a.held ? nx : -nx;
        const mny = a.held ? ny : -ny;
        const vn = moving.vx * mnx + moving.vy * mny;
        const reflected =
          vn < 0
            ? { vx: moving.vx - 2 * vn * mnx, vy: moving.vy - 2 * vn * mny }
            : { vx: moving.vx, vy: moving.vy };
        out[a.held ? j : i] = {
          ...moving,
          ...reflected,
          x: moving.x + mnx * overlap,
          y: moving.y + mny * overlap,
        };
      } else {
        // Equal masses: exchange the components along the normal and leave the
        // tangential components alone, then separate the pair equally.
        const van = a.vx * nx + a.vy * ny;
        const vbn = b.vx * nx + b.vy * ny;
        const exchange = vbn - van;
        out[i] = {
          ...a,
          vx: a.vx + exchange * nx,
          vy: a.vy + exchange * ny,
          x: a.x - (nx * overlap) / 2,
          y: a.y - (ny * overlap) / 2,
        };
        out[j] = {
          ...b,
          vx: b.vx - exchange * nx,
          vy: b.vy - exchange * ny,
          x: b.x + (nx * overlap) / 2,
          y: b.y + (ny * overlap) / 2,
        };
      }
      struck = true;
    }
  }
  return { balls: out, events: struck ? { ...events, ball: true } : events };
}

/**
 * Every ball after `dt` seconds of flight, with every collision they made
 * resolved, beside the events of the frame.
 */
export function step(
  balls: readonly RallyBall[],
  left: PaddleSim,
  right: PaddleSim,
  obstacles: readonly Rect[],
  dt: number,
): RallyStep {
  // The frame is cut into sub-steps short enough that no ball's center can
  // skip past an object in one move, sized by the FASTEST ball in flight so
  // every ball shares the same sub-step clock. Every part of the step — the
  // spin, the integration, and the collisions — happens per SUB-step rather
  // than per frame, so the curve each ball actually travels is resolved to
  // MAX_SUBSTEP units however long the frame was. That is what keeps a rally
  // on a 30 Hz display and the same rally on a 240 Hz one landing in the same
  // place.
  const fastest = balls.reduce(
    (max, ball) => (ball.held ? max : Math.max(max, ballSpeed(ball))),
    0,
  );
  const substeps = Math.max(1, Math.ceil((fastest * dt) / MAX_SUBSTEP));
  const h = dt / substeps;
  // Half the magnitude every SPIN_HALFLIFE seconds. Compounding this per
  // sub-step is exactly the same decay as applying it once over `dt`, because
  // the factors multiply: 0.5^(h/H) taken `substeps` times is 0.5^(dt/H).
  const decay = Math.pow(0.5, h / SPIN_HALFLIFE);

  let current: RallyStep = { balls, events: NO_EVENTS };
  for (let i = 0; i < substeps; i++) {
    const advanced: RallyBall[] = [];
    let events = current.events;
    for (const ball of current.balls) {
      if (ball.held) {
        advanced.push(ball);
        continue;
      }
      const resolved = substepBall(
        { ball, events },
        left,
        right,
        obstacles,
        h,
        decay,
      );
      advanced.push({ ...resolved.ball, held: false });
      events = resolved.events;
    }
    current = resolveBallPairs(advanced, events);
  }
  return current;
}
