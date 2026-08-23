// The physics rules specs/balls.md fixes, checked one at a time against `step()`.
// Everything here is a pure call: no engine, no canvas, no clock.
//
// `step()` takes the whole set of balls and returns the advanced set beside the
// frame's events, so most checks here hand it a single ball and read that one
// back off the result; the ball-to-ball rules at the end hand it two or three.
// The balls handed in are never written: `one` and `pair` below return what the
// step produced, and one check holds the input up against what it was.

import { describe, expect, it } from "vitest";
import {
  BALL_COLLIDE_DIST,
  BALL_R,
  FIELD_H,
  MAX_BOUNCE_ANGLE,
  OBSTACLES,
  SPEED_CAP,
  SPEED_MULT,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
  SPIN_HALFLIFE,
} from "./constants";
import { ballSpeed } from "./entities";
import { step, type StepEvents } from "./physics";
import type { BallState, PaddleState } from "./game";

const FRAME = 1 / 60;

function ball(patch: Partial<BallState> = {}): BallState {
  return {
    x: 640,
    y: 360,
    vx: 0,
    vy: 0,
    spin: 0,
    held: false,
    holdTimer: 0,
    trail: [],
    ...patch,
  };
}

function paddles(leftCy = 360, rightCy = 360): [PaddleState, PaddleState] {
  return [
    { cy: leftCy, vy: 0 },
    { cy: rightCy, vy: 0 },
  ];
}

/** One ball stepped by `dt` against centered (or the given) paddles. */
function one(
  b: BallState,
  dt: number,
  [left, right]: [PaddleState, PaddleState] = paddles(),
): { b: BallState; events: StepEvents } {
  const { balls, events } = step([b], left, right, dt);
  return { b: balls[0], events };
}

/** One ball stepped `count` times by `dt`. */
function repeat(b: BallState, dt: number, count: number): BallState {
  let current = b;
  const [left, right] = paddles();
  for (let i = 0; i < count; i++)
    current = step([current], left, right, dt).balls[0];
  return current;
}

describe("free flight", () => {
  it("advances the ball by velocity times the elapsed time", () => {
    const { b, events } = one(ball({ x: 300, vx: 240, vy: 120 }), 0.5);
    expect(b.x).toBeCloseTo(420, 6);
    expect(b.y).toBeCloseTo(420, 6);
    expect(events).toEqual({
      paddle: false,
      wall: false,
      obstacle: false,
      ball: false,
    });
  });

  it("leaves the balls it was handed exactly as they were", () => {
    const b = ball({ x: 300, vx: 240, vy: 120, spin: 80 });
    const input = [b];
    const [left, right] = paddles();
    const { balls } = step(input, left, right, 0.5);
    expect(b).toEqual(ball({ x: 300, vx: 240, vy: 120, spin: 80 }));
    expect(input).toEqual([b]);
    expect(balls[0]).not.toBe(b);
    expect(left).toEqual({ cy: 360, vy: 0 });
  });

  it("reaches the same place however the interval was divided", () => {
    const once = repeat(ball({ x: 300, vx: 240, vy: 120 }), 0.5, 1);
    const many = repeat(ball({ x: 300, vx: 240, vy: 120 }), FRAME, 30);
    expect(many.x).toBeCloseTo(once.x, 6);
    expect(many.y).toBeCloseTo(once.y, 6);
  });

  it("curves to within a pixel of the same place at 30, 60 and 240 Hz", () => {
    const at = (hz: number): BallState =>
      repeat(ball({ x: 300, vx: 400, vy: 120, spin: 300 }), 1 / hz, hz / 2);
    const slow = at(30);
    const mid = at(60);
    const fast = at(240);
    expect(Math.hypot(mid.x - slow.x, mid.y - slow.y)).toBeLessThan(1);
    expect(Math.hypot(fast.x - slow.x, fast.y - slow.y)).toBeLessThan(1);
    // The spin decay itself composes exactly, whatever the step.
    expect(fast.spin).toBeCloseTo(slow.spin, 9);
  });
});

describe("walls", () => {
  it("reflects off the top wall and keeps its speed", () => {
    const { b, events } = one(ball({ y: 15, vy: -600 }), FRAME);
    expect(events.wall).toBe(true);
    expect(b.vy).toBe(600);
    expect(ballSpeed(b)).toBeCloseTo(600, 9);
    expect(b.y).toBeGreaterThanOrEqual(BALL_R);
  });

  it("reflects off the bottom wall", () => {
    const { b, events } = one(ball({ y: FIELD_H - 15, vy: 600 }), FRAME);
    expect(events.wall).toBe(true);
    expect(b.vy).toBe(-600);
    expect(b.y).toBeLessThanOrEqual(FIELD_H - BALL_R);
  });
});

describe("the paddle bounce", () => {
  it("sends a center hit straight back at 1.04x the speed", () => {
    const { b, events } = one(ball({ x: 76, vx: -400 }), FRAME);
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeCloseTo(400 * SPEED_MULT, 6);
    expect(b.vy).toBeCloseTo(0, 9);
  });

  it("takes the outgoing angle from the contact point", () => {
    const { b } = one(ball({ x: 76, y: 400, vx: -400 }), FRAME);
    // (400 - 360) / 55 of the way to the 55deg maximum.
    const theta = (40 / 55) * MAX_BOUNCE_ANGLE;
    const speed = 400 * SPEED_MULT;
    expect(b.vx).toBeCloseTo(speed * Math.cos(theta), 6);
    expect(b.vy).toBeCloseTo(speed * Math.sin(theta), 6);
  });

  it("caps the speed", () => {
    const { b } = one(ball({ x: 76, vx: -970 }), FRAME);
    expect(ballSpeed(b)).toBeCloseTo(SPEED_CAP, 6);
  });

  it("turns the ball back toward the other goal off the right paddle", () => {
    const { b, events } = one(ball({ x: 1280 - 76, vx: 400 }), FRAME);
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeCloseTo(-400 * SPEED_MULT, 6);
  });

  it("imparts spin from the paddle's motion at contact", () => {
    const [left, right] = paddles();
    const { b } = one(ball({ x: 76, vx: -400 }), FRAME, [
      { ...left, vy: 300 },
      right,
    ]);
    // Imparted mid-frame, so the remainder of the frame's decay has applied.
    const imparted = 300 * SPIN_FROM_PADDLE;
    expect(b.spin).toBeLessThanOrEqual(imparted);
    expect(b.spin).toBeGreaterThan(imparted * 0.98);
  });

  it("imparts no spin from a stationary paddle", () => {
    const { b } = one(ball({ x: 76, vx: -400 }), FRAME);
    expect(b.spin).toBe(0);
  });

  it("clamps the spin it can accumulate", () => {
    const [left, right] = paddles();
    const { b } = one(ball({ x: 76, vx: -400, spin: SPIN_CLAMP }), FRAME, [
      { ...left, vy: 900 },
      right,
    ]);
    expect(b.spin).toBeLessThanOrEqual(SPIN_CLAMP);
  });

  it("reflects like a wall off a paddle's top cap", () => {
    const { b, events } = one(ball({ x: 56, y: 292, vy: 300 }), FRAME);
    expect(events.wall).toBe(true);
    expect(events.paddle).toBe(false);
    expect(b.vy).toBe(-300);
  });

  it("never tunnels through a paddle, even at the speed cap and 5 fps", () => {
    const { b, events } = one(ball({ x: 260, vx: -SPEED_CAP }), 0.2);
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThan(64);
  });
});

describe("obstacles", () => {
  const [obstacle] = OBSTACLES;
  const insideY = (obstacle.y0 + obstacle.y1) / 2;

  it("reflects the ball and leaves speed and spin alone", () => {
    const { b, events } = one(
      ball({ x: obstacle.x0 - BALL_R - 2, y: insideY, vx: 300, spin: 100 }),
      FRAME,
    );
    expect(events.obstacle).toBe(true);
    expect(b.vx).toBeLessThan(0);
    expect(ballSpeed(b)).toBeCloseTo(300, 6);
    // Unchanged by the bounce; only the per-step decay applies.
    expect(b.spin).toBeCloseTo(100 * Math.pow(0.5, FRAME / SPIN_HALFLIFE), 6);
  });

  it("reflects off the flat top of an obstacle", () => {
    const { b, events } = one(
      ball({
        x: (obstacle.x0 + obstacle.x1) / 2,
        y: obstacle.y0 - BALL_R - 2.5,
        vy: 300,
      }),
      FRAME,
    );
    expect(events.obstacle).toBe(true);
    expect(b.vy).toBe(-300);
    expect(b.y).toBeLessThanOrEqual(obstacle.y0 - BALL_R);
  });

  it("never tunnels through an obstacle", () => {
    const { b, events } = one(
      ball({ x: obstacle.x0 - 120, y: insideY, vx: SPEED_CAP }),
      0.2,
    );
    expect(events.obstacle).toBe(true);
    expect(b.x).toBeLessThan(obstacle.x0);
  });
});

describe("spin", () => {
  it("loses half its magnitude every SPIN_HALFLIFE seconds", () => {
    const { b } = one(ball({ spin: 800 }), SPIN_HALFLIFE);
    expect(b.spin).toBeCloseTo(400, 6);
  });

  it("curves the flight without changing the speed", () => {
    const { b } = one(ball({ x: 300, vx: 520, spin: 400 }), FRAME);
    expect(ballSpeed(b)).toBeCloseTo(520, 6);
    // Positive spin turns the velocity toward +y (down the screen).
    expect(b.vy).toBeGreaterThan(0);
  });

  it("curves the opposite way for the opposite sign", () => {
    const { b } = one(ball({ x: 300, vx: 520, spin: -400 }), FRAME);
    expect(b.vy).toBeLessThan(0);
  });
});

describe("ball-to-ball collision", () => {
  /** Two balls stepped together by `dt` against centered paddles. */
  function pair(
    first: BallState,
    second: BallState,
    dt: number,
  ): { a: BallState; b: BallState; events: StepEvents } {
    const [left, right] = paddles();
    const { balls, events } = step([first, second], left, right, dt);
    return { a: balls[0], b: balls[1], events };
  }

  it("exchanges the normal velocities of two moving balls", () => {
    const { a, b, events } = pair(
      ball({ x: 600, vx: 300 }),
      ball({ x: 600 + BALL_COLLIDE_DIST + 1, vx: -300 }),
      FRAME,
    );

    expect(events.ball).toBe(true);
    // A head-on pair of equal masses swaps velocities outright.
    expect(a.vx).toBeCloseTo(-300, 6);
    expect(b.vx).toBeCloseTo(300, 6);
  });

  it("leaves the tangential components alone", () => {
    const { a, b } = pair(
      ball({ x: 600, vx: 300, vy: 120 }),
      ball({ x: 600 + BALL_COLLIDE_DIST + 1, vx: -300, vy: 120 }),
      FRAME,
    );

    expect(a.vy).toBeCloseTo(120, 6);
    expect(b.vy).toBeCloseTo(120, 6);
  });

  it("leaves both spins alone", () => {
    const { a, b } = pair(
      ball({ x: 600, vx: 300, spin: 200 }),
      ball({ x: 600 + BALL_COLLIDE_DIST + 1, vx: -300 }),
      FRAME,
    );

    // Only the per-step decay touched it.
    expect(a.spin).toBeCloseTo(200 * Math.pow(0.5, FRAME / SPIN_HALFLIFE), 6);
    expect(b.spin).toBe(0);
  });

  it("pushes an overlapping pair back out of each other", () => {
    const { a, b } = pair(
      ball({ x: 600, vx: 0 }),
      ball({ x: 600 + BALL_COLLIDE_DIST - 6, vx: 0 }),
      FRAME,
    );

    expect(b.x - a.x).toBeCloseTo(BALL_COLLIDE_DIST, 6);
  });

  it("bounces a moving ball off a waiting one and leaves the wait alone", () => {
    const {
      a: waiting,
      b: moving,
      events,
    } = pair(
      ball({ x: 640, y: 360, held: true, holdTimer: 0.5 }),
      ball({ x: 500, y: 360, vx: 600 }),
      0.4,
    );

    expect(events.ball).toBe(true);
    expect(moving.vx).toBeLessThan(0);
    // The waiting ball is immovable: it keeps its place, its stillness, and its
    // countdown.
    expect(waiting.x).toBe(640);
    expect(waiting.y).toBe(360);
    expect(waiting.vx).toBe(0);
    expect(waiting.holdTimer).toBe(0.5);
  });

  it("keeps every pair apart at the speed cap and 5 fps", () => {
    const { a, b } = pair(
      ball({ x: 440, y: 360, vx: SPEED_CAP }),
      ball({ x: 840, y: 360, vx: -SPEED_CAP }),
      0.2,
    );

    // Whatever else happened, neither passed through the other.
    expect(a.x).toBeLessThan(b.x);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(
      BALL_COLLIDE_DIST - 1e-6,
    );
  });

  it("advances balls that never meet exactly as it would alone", () => {
    const { a: together } = pair(
      ball({ x: 300, y: 200, vx: 240, vy: 120, spin: 150 }),
      ball({ x: 900, y: 600, vx: -240 }),
      FRAME,
    );
    const { b: alone } = one(
      ball({ x: 300, y: 200, vx: 240, vy: 120, spin: 150 }),
      FRAME,
    );

    expect(together.x).toBeCloseTo(alone.x, 9);
    expect(together.y).toBeCloseTo(alone.y, 9);
    expect(together.spin).toBeCloseTo(alone.spin, 9);
  });
});
