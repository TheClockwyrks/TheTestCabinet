// The physics rules specs/balls.md fixes, checked one at a time against `step()`.
// Everything here is a pure call: no engine, no canvas, no clock.

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
import { ballSpeed } from "./entities";
import { step } from "./physics";
import type { BallState, PaddleState } from "./game";

const FRAME = 1 / 60;

function ball(patch: Partial<BallState> = {}): BallState {
  return { x: 640, y: 360, vx: 0, vy: 0, spin: 0, ...patch };
}

function paddles(leftCy = 360, rightCy = 360): [PaddleState, PaddleState] {
  return [
    { cy: leftCy, vy: 0 },
    { cy: rightCy, vy: 0 },
  ];
}

describe("free flight", () => {
  it("advances the ball by velocity times the elapsed time", () => {
    const b = ball({ x: 300, vx: 240, vy: 120 });
    const [left, right] = paddles();
    const events = step(b, left, right, 0.5);
    expect(b.x).toBeCloseTo(420, 6);
    expect(b.y).toBeCloseTo(420, 6);
    expect(events).toEqual({ paddle: false, wall: false, obstacle: false });
  });

  it("reaches the same place however the interval was divided", () => {
    const once = ball({ x: 300, vx: 240, vy: 120 });
    const many = ball({ x: 300, vx: 240, vy: 120 });
    const [l1, r1] = paddles();
    const [l2, r2] = paddles();
    step(once, l1, r1, 0.5);
    for (let i = 0; i < 30; i++) step(many, l2, r2, FRAME);
    expect(many.x).toBeCloseTo(once.x, 6);
    expect(many.y).toBeCloseTo(once.y, 6);
  });

  it("curves to within a pixel of the same place at 30, 60 and 240 Hz", () => {
    const at = (hz: number): BallState => {
      const b = ball({ x: 300, vx: 400, vy: 120, spin: 300 });
      const [left, right] = paddles();
      for (let i = 0; i < hz / 2; i++) step(b, left, right, 1 / hz);
      return b;
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
    const b = ball({ y: 15, vy: -600 });
    const [left, right] = paddles();
    const events = step(b, left, right, FRAME);
    expect(events.wall).toBe(true);
    expect(b.vy).toBe(600);
    expect(ballSpeed(b)).toBeCloseTo(600, 9);
    expect(b.y).toBeGreaterThanOrEqual(BALL_R);
  });

  it("reflects off the bottom wall", () => {
    const b = ball({ y: FIELD_H - 15, vy: 600 });
    const [left, right] = paddles();
    const events = step(b, left, right, FRAME);
    expect(events.wall).toBe(true);
    expect(b.vy).toBe(-600);
    expect(b.y).toBeLessThanOrEqual(FIELD_H - BALL_R);
  });
});

describe("the paddle bounce", () => {
  it("sends a center hit straight back at 1.04x the speed", () => {
    const b = ball({ x: 76, vx: -400 });
    const [left, right] = paddles();
    const events = step(b, left, right, FRAME);
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeCloseTo(400 * SPEED_MULT, 6);
    expect(b.vy).toBeCloseTo(0, 9);
  });

  it("takes the outgoing angle from the contact point", () => {
    const b = ball({ x: 76, y: 400, vx: -400 });
    const [left, right] = paddles();
    step(b, left, right, FRAME);
    // (400 - 360) / 55 of the way to the 55deg maximum.
    const theta = (40 / 55) * MAX_BOUNCE_ANGLE;
    const speed = 400 * SPEED_MULT;
    expect(b.vx).toBeCloseTo(speed * Math.cos(theta), 6);
    expect(b.vy).toBeCloseTo(speed * Math.sin(theta), 6);
  });

  it("caps the speed", () => {
    const b = ball({ x: 76, vx: -970 });
    const [left, right] = paddles();
    step(b, left, right, FRAME);
    expect(ballSpeed(b)).toBeCloseTo(SPEED_CAP, 6);
  });

  it("turns the ball back toward the other goal off the right paddle", () => {
    const b = ball({ x: 1280 - 76, vx: 400 });
    const [left, right] = paddles();
    const events = step(b, left, right, FRAME);
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeCloseTo(-400 * SPEED_MULT, 6);
  });

  it("imparts spin from the paddle's motion at contact", () => {
    const b = ball({ x: 76, vx: -400 });
    const [left, right] = paddles();
    left.vy = 300;
    step(b, left, right, FRAME);
    // Imparted mid-frame, so the remainder of the frame's decay has applied.
    const imparted = 300 * SPIN_FROM_PADDLE;
    expect(b.spin).toBeLessThanOrEqual(imparted);
    expect(b.spin).toBeGreaterThan(imparted * 0.98);
  });

  it("imparts no spin from a stationary paddle", () => {
    const b = ball({ x: 76, vx: -400 });
    const [left, right] = paddles();
    step(b, left, right, FRAME);
    expect(b.spin).toBe(0);
  });

  it("clamps the spin it can accumulate", () => {
    const b = ball({ x: 76, vx: -400, spin: SPIN_CLAMP });
    const [left, right] = paddles();
    left.vy = 900;
    step(b, left, right, FRAME);
    expect(b.spin).toBeLessThanOrEqual(SPIN_CLAMP);
  });

  it("reflects like a wall off a paddle's top cap", () => {
    const b = ball({ x: 56, y: 292, vy: 300 });
    const [left, right] = paddles();
    const events = step(b, left, right, FRAME);
    expect(events.wall).toBe(true);
    expect(events.paddle).toBe(false);
    expect(b.vy).toBe(-300);
  });

  it("never tunnels through a paddle, even at the speed cap and 5 fps", () => {
    const b = ball({ x: 260, vx: -SPEED_CAP });
    const [left, right] = paddles();
    const events = step(b, left, right, 0.2);
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThan(64);
  });
});

describe("obstacles", () => {
  const [obstacle] = OBSTACLES;
  const insideY = (obstacle.y0 + obstacle.y1) / 2;

  it("reflects the ball and leaves speed and spin alone", () => {
    const b = ball({
      x: obstacle.x0 - BALL_R - 2,
      y: insideY,
      vx: 300,
      spin: 100,
    });
    const [left, right] = paddles();
    const events = step(b, left, right, FRAME);
    expect(events.obstacle).toBe(true);
    expect(b.vx).toBeLessThan(0);
    expect(ballSpeed(b)).toBeCloseTo(300, 6);
    // Unchanged by the bounce; only the per-step decay applies.
    expect(b.spin).toBeCloseTo(100 * Math.pow(0.5, FRAME / SPIN_HALFLIFE), 6);
  });

  it("reflects off the flat top of an obstacle", () => {
    const b = ball({
      x: (obstacle.x0 + obstacle.x1) / 2,
      y: obstacle.y0 - BALL_R - 2.5,
      vy: 300,
    });
    const [left, right] = paddles();
    const events = step(b, left, right, FRAME);
    expect(events.obstacle).toBe(true);
    expect(b.vy).toBe(-300);
    expect(b.y).toBeLessThanOrEqual(obstacle.y0 - BALL_R);
  });

  it("never tunnels through an obstacle", () => {
    const b = ball({ x: obstacle.x0 - 120, y: insideY, vx: SPEED_CAP });
    const [left, right] = paddles();
    const events = step(b, left, right, 0.2);
    expect(events.obstacle).toBe(true);
    expect(b.x).toBeLessThan(obstacle.x0);
  });
});

describe("spin", () => {
  it("loses half its magnitude every SPIN_HALFLIFE seconds", () => {
    const b = ball({ spin: 800 });
    const [left, right] = paddles();
    step(b, left, right, SPIN_HALFLIFE);
    expect(b.spin).toBeCloseTo(400, 6);
  });

  it("curves the flight without changing the speed", () => {
    const b = ball({ x: 300, vx: 520, spin: 400 });
    const [left, right] = paddles();
    step(b, left, right, FRAME);
    expect(ballSpeed(b)).toBeCloseTo(520, 6);
    // Positive spin turns the velocity toward +y (down the screen).
    expect(b.vy).toBeGreaterThan(0);
  });

  it("curves the opposite way for the opposite sign", () => {
    const b = ball({ x: 300, vx: 520, spin: -400 });
    const [left, right] = paddles();
    step(b, left, right, FRAME);
    expect(b.vy).toBeLessThan(0);
  });
});
