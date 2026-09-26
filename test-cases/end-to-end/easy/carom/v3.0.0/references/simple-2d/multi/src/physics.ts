// Carom — physics, collision, and the spin mechanic (specs/balls.md).
//
// `step()` advances every ball by one frame's elapsed SECONDS: each curves by its
// own spin, decays that spin, then integrates and resolves its collisions, and the
// balls are finally resolved against one another. Every rate it uses is per second
// and is multiplied by `dt`, so the same interval of game time reaches the same
// state however it was divided into frames — which is the property the debug API
// in `src/debug.ts` leans on.
//
// To guarantee no ball tunnels through a paddle, wall, obstacle, or another ball
// at high speed, the integration is split into sub-steps short enough
// (<= MAX_SUBSTEP units of travel) that a ball's center can never skip past an
// object in one move. The three balls advance in LOCK STEP through those
// sub-steps, so a pair closing head-on is resolved at the sub-step they meet
// rather than after one of them has crossed the other.
//
// Nothing here writes to a ball it is handed. Every resolution takes a ball and
// the events so far and returns the ball as it is after the contact beside the
// events with that contact added, and `step()` returns the advanced balls beside
// the events of the whole frame. The caller puts the balls into the state it
// builds and plays one cue per event.

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
import { ballSpeed, clamp, paddleFrontX, paddleRect } from "./entities";
import type { BallState, PaddleState, Side } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** The read-only view of a paddle the collision reads at contact. */
type Paddle = DeepReadonly<PaddleState>;

/** What one step's collisions did, so the caller can play a cue per event. */
export interface StepEvents {
  readonly paddle: boolean;
  readonly wall: boolean;
  readonly obstacle: boolean;
  /** A ball struck another ball. */
  readonly ball: boolean;
}

/** What `step()` returns: the balls after the frame, and what they struck. */
export interface StepResult {
  readonly balls: readonly BallState[];
  readonly events: StepEvents;
}

/** One ball's resolution against one thing: the ball after it, and the events. */
interface Resolved {
  readonly ball: BallState;
  readonly events: StepEvents;
}

const NO_EVENTS: StepEvents = {
  paddle: false,
  wall: false,
  obstacle: false,
  ball: false,
};

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
  paddle: Paddle,
  side: Side,
): BallState {
  const offset = clamp((ball.y - paddle.cy) / PADDLE_HALF, -1, 1);
  const theta = offset * MAX_BOUNCE_ANGLE;
  const speed = Math.min(ballSpeed(ball) * SPEED_MULT, SPEED_CAP);
  const dir = side === "left" ? 1 : -1; // horizontal, toward the opponent
  // Placed just off the front face so the same contact cannot re-trigger.
  const front = paddleFrontX(side);
  return {
    ...ball,
    x: side === "left" ? front + BALL_R : front - BALL_R,
    vx: dir * speed * Math.cos(theta),
    vy: speed * Math.sin(theta),
    spin: clamp(
      ball.spin + paddle.vy * SPIN_FROM_PADDLE,
      -SPIN_CLAMP,
      SPIN_CLAMP,
    ),
  };
}

function resolvePaddle(
  ball: BallState,
  paddle: Paddle,
  side: Side,
  events: StepEvents,
): Resolved {
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
  return {
    ball: {
      ...ball,
      y: hit.place,
      vy: ball.vy * hit.normal < 0 ? -ball.vy : ball.vy,
    },
    events: { ...events, wall: true },
  };
}

function resolveObstacle(
  ball: BallState,
  rect: Rect,
  events: StepEvents,
): Resolved {
  const hit = collideCircleRect(ball.x, ball.y, BALL_R, rect);
  if (!hit) return { ball, events };
  // Reflect the velocity component normal to the struck face and push out. Speed
  // and spin are preserved, so the spin keeps curving the ball after the bounce.
  const struck: BallState =
    hit.axis === "x"
      ? {
          ...ball,
          x: hit.place,
          vx: ball.vx * hit.normal < 0 ? -ball.vx : ball.vx,
        }
      : {
          ...ball,
          y: hit.place,
          vy: ball.vy * hit.normal < 0 ? -ball.vy : ball.vy,
        };
  return { ball: struck, events: { ...events, obstacle: true } };
}

function resolveWalls(ball: BallState, events: StepEvents): Resolved {
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
 * Every pair of balls in contact resolved, as elastic circles of equal mass.
 *
 * A ball waiting at its home point is IMMOVABLE: the moving ball reflects about
 * the contact normal and is pushed clear while the waiting ball keeps its place
 * and its hold timer, which is what makes a ball counting down a solid obstacle
 * rather than a ghost. Neither ball's spin changes, and no speed is created — the
 * velocities the two balls already carry are only redistributed.
 *
 * Pairs are resolved in index order, each against the balls as the pairs before
 * it left them, so `out` is the working copy the resolutions are written through.
 */
function resolveBallPairs(
  balls: readonly BallState[],
  events: StepEvents,
): StepResult {
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
        // One of them is immovable. Reflect the other about the contact normal,
        // pointing out of the waiting ball, and push it fully clear.
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

/** One ball advanced through a single sub-step, with what it strikes resolved. */
function substepBall(
  ball: BallState,
  left: Paddle,
  right: Paddle,
  obstacles: readonly Rect[],
  h: number,
  decay: number,
  events: StepEvents,
): Resolved {
  // 1. Spin curves the flight. Rotating the velocity vector at an angular rate
  //    of `spin / speed` turns the path without changing the speed, which is
  //    exactly what a lateral acceleration of magnitude |spin| does.
  const speed = ballSpeed(ball);
  const curved = curve(ball, speed, h);
  const decayed: BallState = { ...curved, spin: curved.spin * decay };

  // 2. Advance the position by the elapsed time.
  const moved: BallState = {
    ...decayed,
    x: decayed.x + decayed.vx * h,
    y: decayed.y + decayed.vy * h,
  };

  // 3. Resolve every collision the move could have made. The other balls come
  //    afterward, once every ball has taken this sub-step.
  const walled = resolveWalls(moved, events);
  const offLeft = resolvePaddle(walled.ball, left, "left", walled.events);
  const offRight = resolvePaddle(offLeft.ball, right, "right", offLeft.events);
  return obstacles.reduce<Resolved>(
    (so, obstacle) => resolveObstacle(so.ball, obstacle, so.events),
    offRight,
  );
}

/** The velocity turned by the ball's spin over `h` seconds; the speed is kept. */
function curve(ball: BallState, speed: number, h: number): BallState {
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

/**
 * Every ball advanced by `dt` seconds with every collision they make resolved,
 * beside the events of the frame.
 */
export function step(
  balls: readonly BallState[],
  left: Paddle,
  right: Paddle,
  obstacles: readonly Rect[],
  dt: number,
): StepResult {
  // The frame is cut into sub-steps short enough that no ball's center can skip
  // past an object in one move, sized by the FASTEST ball so every ball shares the
  // same sub-step clock. Every part of the step below — the spin, the integration,
  // and the collisions — happens per SUB-step rather than per frame, so the curve
  // each ball actually travels is resolved to MAX_SUBSTEP units however long the
  // frame was. That is what keeps a rally on a 30 Hz display and the same rally on
  // a 240 Hz one landing in the same place.
  const fastest = balls.reduce(
    (max, ball) => (ball.held ? max : Math.max(max, ballSpeed(ball))),
    0,
  );
  const substeps = Math.max(1, Math.ceil((fastest * dt) / MAX_SUBSTEP));
  const h = dt / substeps;
  // Half the magnitude every SPIN_HALFLIFE seconds. Compounding this per sub-step
  // is exactly the same decay as applying it once over `dt`, because the factors
  // multiply: 0.5^(h/H) taken `substeps` times is 0.5^(dt/H).
  const decay = Math.pow(0.5, h / SPIN_HALFLIFE);

  let current: StepResult = { balls, events: NO_EVENTS };
  for (let i = 0; i < substeps; i++) {
    const advanced: BallState[] = [];
    let events = current.events;
    for (const ball of current.balls) {
      if (ball.held) {
        advanced.push(ball);
        continue;
      }
      const resolved = substepBall(
        ball,
        left,
        right,
        obstacles,
        h,
        decay,
        events,
      );
      advanced.push(resolved.ball);
      events = resolved.events;
    }
    current = resolveBallPairs(advanced, events);
  }

  return current;
}
