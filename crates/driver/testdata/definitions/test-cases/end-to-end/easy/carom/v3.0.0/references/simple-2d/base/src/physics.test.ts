// The physics rules specs/balls.md fixes, checked one at a time against `step()`.
// Everything here is a pure call: no engine, no canvas, no clock. `step` returns
// the ball it computed beside the events it saw, so every check reads the
// returned flight and the ball it was given is never written to.

import { describe, expect, it } from "vitest";
import {
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
import { allObstacles, ballSpeed } from "./entities";
import { step as stepAgainst, type Flight } from "./physics";
import type { BallState, PaddleState } from "./game";

const FRAME = 1 / 60;

/** Both obstacles in the field, which is how a match is played. */
const FIELD_OBSTACLES = allObstacles();

/** `step` against the field as a match has it: both obstacles present. */
function step(
  ball: BallState,
  left: PaddleState,
  right: PaddleState,
  dt: number,
): Flight {
  return stepAgainst(ball, left, right, FIELD_OBSTACLES, dt);
}

function ball(patch: Partial<BallState> = {}): BallState {
  return {
    x: 640,
    y: 360,
    vx: 0,
    vy: 0,
    spin: 0,
    held: false,
    holdTimer: 0,
    serveSign: 1,
    trail: [],
    ...patch,
  };
}

function paddle(cy: number, vy = 0): PaddleState {
  return { cy, vy, driven: false, drivenVy: 0 };
}

function paddles(leftCy = 360, rightCy = 360): [PaddleState, PaddleState] {
  return [paddle(leftCy), paddle(rightCy)];
}

/** The ball after `frames` steps of `dt` each against the same two paddles. */
function fly(
  start: BallState,
  left: PaddleState,
  right: PaddleState,
  dt: number,
  frames: number,
): BallState {
  let b = start;
  for (let i = 0; i < frames; i++) b = step(b, left, right, dt).ball;
  return b;
}

describe("free flight", () => {
  it("advances the ball by velocity times the elapsed time", () => {
    const start = ball({ x: 300, vx: 240, vy: 120 });
    const [left, right] = paddles();
    const { ball: b, events } = step(start, left, right, 0.5);
    expect(b.x).toBeCloseTo(420, 6);
    expect(b.y).toBeCloseTo(420, 6);
    expect(events).toEqual({ paddle: false, wall: false, obstacle: false });
    // The ball it was given is untouched.
    expect(start).toEqual(ball({ x: 300, vx: 240, vy: 120 }));
  });

  it("reaches the same place however the interval was divided", () => {
    const [left, right] = paddles();
    const once = step(
      ball({ x: 300, vx: 240, vy: 120 }),
      left,
      right,
      0.5,
    ).ball;
    const many = fly(
      ball({ x: 300, vx: 240, vy: 120 }),
      left,
      right,
      FRAME,
      30,
    );
    expect(many.x).toBeCloseTo(once.x, 6);
    expect(many.y).toBeCloseTo(once.y, 6);
  });

  it("curves to within a pixel of the same place at 30, 60 and 240 Hz", () => {
    const at = (hz: number): BallState => {
      const [left, right] = paddles();
      return fly(
        ball({ x: 300, vx: 400, vy: 120, spin: 300 }),
        left,
        right,
        1 / hz,
        hz / 2,
      );
    };
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
    const [left, right] = paddles();
    const { ball: b, events } = step(
      ball({ y: 15, vy: -600 }),
      left,
      right,
      FRAME,
    );
    expect(events.wall).toBe(true);
    expect(b.vy).toBe(600);
    expect(ballSpeed(b)).toBeCloseTo(600, 9);
    expect(b.y).toBeGreaterThanOrEqual(BALL_R);
  });

  it("reflects off the bottom wall", () => {
    const [left, right] = paddles();
    const { ball: b, events } = step(
      ball({ y: FIELD_H - 15, vy: 600 }),
      left,
      right,
      FRAME,
    );
    expect(events.wall).toBe(true);
    expect(b.vy).toBe(-600);
    expect(b.y).toBeLessThanOrEqual(FIELD_H - BALL_R);
  });
});

describe("the paddle bounce", () => {
  it("sends a center hit straight back at 1.04x the speed", () => {
    const [left, right] = paddles();
    const { ball: b, events } = step(
      ball({ x: 76, vx: -400 }),
      left,
      right,
      FRAME,
    );
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeCloseTo(400 * SPEED_MULT, 6);
    expect(b.vy).toBeCloseTo(0, 9);
  });

  it("takes the outgoing angle from the contact point", () => {
    const [left, right] = paddles();
    const b = step(ball({ x: 76, y: 400, vx: -400 }), left, right, FRAME).ball;
    // (400 - 360) / 55 of the way to the 55deg maximum.
    const theta = (40 / 55) * MAX_BOUNCE_ANGLE;
    const speed = 400 * SPEED_MULT;
    expect(b.vx).toBeCloseTo(speed * Math.cos(theta), 6);
    expect(b.vy).toBeCloseTo(speed * Math.sin(theta), 6);
  });

  it("caps the speed", () => {
    const [left, right] = paddles();
    const b = step(ball({ x: 76, vx: -970 }), left, right, FRAME).ball;
    expect(ballSpeed(b)).toBeCloseTo(SPEED_CAP, 6);
  });

  it("turns the ball back toward the other goal off the right paddle", () => {
    const [left, right] = paddles();
    const { ball: b, events } = step(
      ball({ x: 1280 - 76, vx: 400 }),
      left,
      right,
      FRAME,
    );
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeCloseTo(-400 * SPEED_MULT, 6);
  });

  it("imparts spin from the paddle's motion at contact", () => {
    const [, right] = paddles();
    const left = paddle(360, 300);
    const b = step(ball({ x: 76, vx: -400 }), left, right, FRAME).ball;
    // Imparted mid-frame, so the remainder of the frame's decay has applied.
    const imparted = 300 * SPIN_FROM_PADDLE;
    expect(b.spin).toBeLessThanOrEqual(imparted);
    expect(b.spin).toBeGreaterThan(imparted * 0.98);
  });

  it("imparts no spin from a stationary paddle", () => {
    const [left, right] = paddles();
    const b = step(ball({ x: 76, vx: -400 }), left, right, FRAME).ball;
    expect(b.spin).toBe(0);
  });

  it("clamps the spin it can accumulate", () => {
    const [, right] = paddles();
    const left = paddle(360, 900);
    const b = step(
      ball({ x: 76, vx: -400, spin: SPIN_CLAMP }),
      left,
      right,
      FRAME,
    ).ball;
    expect(b.spin).toBeLessThanOrEqual(SPIN_CLAMP);
  });

  it("reflects like a wall off a paddle's top cap", () => {
    const [left, right] = paddles();
    const { ball: b, events } = step(
      ball({ x: 56, y: 292, vy: 300 }),
      left,
      right,
      FRAME,
    );
    expect(events.wall).toBe(true);
    expect(events.paddle).toBe(false);
    expect(b.vy).toBe(-300);
  });

  it("never tunnels through a paddle, even at the speed cap and 5 fps", () => {
    const [left, right] = paddles();
    const { ball: b, events } = step(
      ball({ x: 260, vx: -SPEED_CAP }),
      left,
      right,
      0.2,
    );
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThan(64);
  });
});

describe("obstacles", () => {
  const [obstacle] = OBSTACLES;
  const insideY = (obstacle.y0 + obstacle.y1) / 2;

  it("reflects the ball and leaves speed and spin alone", () => {
    const [left, right] = paddles();
    const { ball: b, events } = step(
      ball({
        x: obstacle.x0 - BALL_R - 2,
        y: insideY,
        vx: 300,
        spin: 100,
      }),
      left,
      right,
      FRAME,
    );
    expect(events.obstacle).toBe(true);
    expect(b.vx).toBeLessThan(0);
    expect(ballSpeed(b)).toBeCloseTo(300, 6);
    // Unchanged by the bounce; only the per-step decay applies.
    expect(b.spin).toBeCloseTo(100 * Math.pow(0.5, FRAME / SPIN_HALFLIFE), 6);
  });

  it("reflects off the flat top of an obstacle", () => {
    const [left, right] = paddles();
    const { ball: b, events } = step(
      ball({
        x: (obstacle.x0 + obstacle.x1) / 2,
        y: obstacle.y0 - BALL_R - 2.5,
        vy: 300,
      }),
      left,
      right,
      FRAME,
    );
    expect(events.obstacle).toBe(true);
    expect(b.vy).toBe(-300);
    expect(b.y).toBeLessThanOrEqual(obstacle.y0 - BALL_R);
  });

  it("has no collision at all once it has been taken out of the field", () => {
    const [left, right] = paddles();
    const { ball: b, events } = stepAgainst(
      ball({ x: obstacle.x0 - BALL_R - 2, y: insideY, vx: 300 }),
      left,
      right,
      // The field with obstacle A removed: only B is left in it.
      FIELD_OBSTACLES.filter((o) => o.index !== 0),
      FRAME,
    );
    expect(events.obstacle).toBe(false);
    expect(b.vx).toBe(300);
  });

  it("never tunnels through an obstacle", () => {
    const [left, right] = paddles();
    const { ball: b, events } = step(
      ball({ x: obstacle.x0 - 120, y: insideY, vx: SPEED_CAP }),
      left,
      right,
      0.2,
    );
    expect(events.obstacle).toBe(true);
    expect(b.x).toBeLessThan(obstacle.x0);
  });
});

describe("spin", () => {
  it("loses half its magnitude every SPIN_HALFLIFE seconds", () => {
    const [left, right] = paddles();
    const b = step(ball({ spin: 800 }), left, right, SPIN_HALFLIFE).ball;
    expect(b.spin).toBeCloseTo(400, 6);
  });

  it("curves the flight without changing the speed", () => {
    const [left, right] = paddles();
    const b = step(
      ball({ x: 300, vx: 520, spin: 400 }),
      left,
      right,
      FRAME,
    ).ball;
    expect(ballSpeed(b)).toBeCloseTo(520, 6);
    // Positive spin turns the velocity toward +y (down the screen).
    expect(b.vy).toBeGreaterThan(0);
  });

  it("curves the opposite way for the opposite sign", () => {
    const [left, right] = paddles();
    const b = step(
      ball({ x: 300, vx: 520, spin: -400 }),
      left,
      right,
      FRAME,
    ).ball;
    expect(b.vy).toBeLessThan(0);
  });
});
