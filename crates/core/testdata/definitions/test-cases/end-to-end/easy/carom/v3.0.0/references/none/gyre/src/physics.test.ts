// The physics rules specs/balls.md fixes, checked one at a time against `step()`.
// Everything here is a pure call: no runtime, no canvas, no clock.

import { describe, expect, it } from "vitest";
import {
  BALL_R,
  FIELD_H,
  MAX_BOUNCE_ANGLE,
  OBSTACLE_CENTERS,
  OBSTACLE_HH,
  OBSTACLE_HW,
  OBSTACLES,
  SPEED_CAP,
  SPEED_MULT,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
  SPIN_HALFLIFE,
} from "./constants";
import { ballSpeed, createBall, createPaddle } from "./entities";
import { obstaclePose } from "./obstacles";
import { step } from "./physics";
import type { BallState, ObstacleState, PaddleState } from "./game";

const FRAME = 1 / 60;

/**
 * The obstacle poses at a given clock. Most checks below are about the ball
 * rather than the obstacles, so they pass the UPRIGHT pose (clock 0), where the
 * oriented collision reduces to the axis-aligned one and `OBSTACLES` describes
 * the same boxes.
 */
function obstacles(t = 0): ObstacleState[] {
  return OBSTACLE_CENTERS.map((_, i) => obstaclePose(i, t));
}

const UPRIGHT = obstacles(0);

function ball(patch: Partial<BallState> = {}): BallState {
  return {
    ...createBall(),
    x: 640,
    y: 360,
    held: false,
    holdTimer: 0,
    ...patch,
  };
}

function paddles(leftCy = 360, rightCy = 360): [PaddleState, PaddleState] {
  return [
    { ...createPaddle(), cy: leftCy },
    { ...createPaddle(), cy: rightCy },
  ];
}

describe("free flight", () => {
  it("advances the ball by velocity times the elapsed time", () => {
    const b = ball({ x: 300, vx: 240, vy: 120 });
    const [left, right] = paddles();
    const events = step(b, left, right, UPRIGHT, 0.5);
    expect(b.x).toBeCloseTo(420, 6);
    expect(b.y).toBeCloseTo(420, 6);
    expect(events).toEqual({ paddle: false, wall: false, obstacle: false });
  });

  it("reaches the same place however the interval was divided", () => {
    const once = ball({ x: 300, vx: 240, vy: 120 });
    const many = ball({ x: 300, vx: 240, vy: 120 });
    const [l1, r1] = paddles();
    const [l2, r2] = paddles();
    step(once, l1, r1, UPRIGHT, 0.5);
    for (let i = 0; i < 30; i++) step(many, l2, r2, UPRIGHT, FRAME);
    expect(many.x).toBeCloseTo(once.x, 6);
    expect(many.y).toBeCloseTo(once.y, 6);
  });

  it("curves to within a pixel of the same place at 30, 60 and 240 Hz", () => {
    const at = (hz: number): BallState => {
      const b = ball({ x: 300, vx: 400, vy: 120, spin: 300 });
      const [left, right] = paddles();
      for (let i = 0; i < hz / 2; i++) step(b, left, right, UPRIGHT, 1 / hz);
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
    const events = step(b, left, right, UPRIGHT, FRAME);
    expect(events.wall).toBe(true);
    expect(b.vy).toBe(600);
    expect(ballSpeed(b)).toBeCloseTo(600, 9);
    expect(b.y).toBeGreaterThanOrEqual(BALL_R);
  });

  it("reflects off the bottom wall", () => {
    const b = ball({ y: FIELD_H - 15, vy: 600 });
    const [left, right] = paddles();
    const events = step(b, left, right, UPRIGHT, FRAME);
    expect(events.wall).toBe(true);
    expect(b.vy).toBe(-600);
    expect(b.y).toBeLessThanOrEqual(FIELD_H - BALL_R);
  });
});

describe("the paddle bounce", () => {
  it("sends a center hit straight back at 1.04x the speed", () => {
    const b = ball({ x: 76, vx: -400 });
    const [left, right] = paddles();
    const events = step(b, left, right, UPRIGHT, FRAME);
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeCloseTo(400 * SPEED_MULT, 6);
    expect(b.vy).toBeCloseTo(0, 9);
  });

  it("takes the outgoing angle from the contact point", () => {
    const b = ball({ x: 76, y: 400, vx: -400 });
    const [left, right] = paddles();
    step(b, left, right, UPRIGHT, FRAME);
    // (400 - 360) / 55 of the way to the 55deg maximum.
    const theta = (40 / 55) * MAX_BOUNCE_ANGLE;
    const speed = 400 * SPEED_MULT;
    expect(b.vx).toBeCloseTo(speed * Math.cos(theta), 6);
    expect(b.vy).toBeCloseTo(speed * Math.sin(theta), 6);
  });

  it("caps the speed", () => {
    const b = ball({ x: 76, vx: -970 });
    const [left, right] = paddles();
    step(b, left, right, UPRIGHT, FRAME);
    expect(ballSpeed(b)).toBeCloseTo(SPEED_CAP, 6);
  });

  it("turns the ball back toward the other goal off the right paddle", () => {
    const b = ball({ x: 1280 - 76, vx: 400 });
    const [left, right] = paddles();
    const events = step(b, left, right, UPRIGHT, FRAME);
    expect(events.paddle).toBe(true);
    expect(b.vx).toBeCloseTo(-400 * SPEED_MULT, 6);
  });

  it("imparts spin from the paddle's motion at contact", () => {
    const b = ball({ x: 76, vx: -400 });
    const [left, right] = paddles();
    left.vy = 300;
    step(b, left, right, UPRIGHT, FRAME);
    // Imparted mid-frame, so the remainder of the frame's decay has applied.
    const imparted = 300 * SPIN_FROM_PADDLE;
    expect(b.spin).toBeLessThanOrEqual(imparted);
    expect(b.spin).toBeGreaterThan(imparted * 0.98);
  });

  it("imparts no spin from a stationary paddle", () => {
    const b = ball({ x: 76, vx: -400 });
    const [left, right] = paddles();
    step(b, left, right, UPRIGHT, FRAME);
    expect(b.spin).toBe(0);
  });

  it("clamps the spin it can accumulate", () => {
    const b = ball({ x: 76, vx: -400, spin: SPIN_CLAMP });
    const [left, right] = paddles();
    left.vy = 900;
    step(b, left, right, UPRIGHT, FRAME);
    expect(b.spin).toBeLessThanOrEqual(SPIN_CLAMP);
  });

  it("reflects like a wall off a paddle's top cap", () => {
    const b = ball({ x: 56, y: 292, vy: 300 });
    const [left, right] = paddles();
    const events = step(b, left, right, UPRIGHT, FRAME);
    expect(events.wall).toBe(true);
    expect(events.paddle).toBe(false);
    expect(b.vy).toBe(-300);
  });

  it("never tunnels through a paddle, even at the speed cap and 5 fps", () => {
    const b = ball({ x: 260, vx: -SPEED_CAP });
    const [left, right] = paddles();
    const events = step(b, left, right, UPRIGHT, 0.2);
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
    const events = step(b, left, right, UPRIGHT, FRAME);
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
    const events = step(b, left, right, UPRIGHT, FRAME);
    expect(events.obstacle).toBe(true);
    expect(b.vy).toBe(-300);
    expect(b.y).toBeLessThanOrEqual(obstacle.y0 - BALL_R);
  });

  it("never tunnels through an obstacle", () => {
    const b = ball({ x: obstacle.x0 - 120, y: insideY, vx: SPEED_CAP });
    const [left, right] = paddles();
    const events = step(b, left, right, UPRIGHT, 0.2);
    expect(events.obstacle).toBe(true);
    expect(b.x).toBeLessThan(obstacle.x0);
  });
});

describe("oriented obstacles", () => {
  const A = OBSTACLE_CENTERS[0]!;

  /** A pose for obstacle A alone, with B moved far out of the way. */
  function only(theta: number, cy = A.y): ObstacleState[] {
    return [
      { index: 0, cx: A.x, cy, theta },
      { index: 1, cx: -10_000, cy: -10_000, theta: 0 },
    ];
  }

  it("reduces to the axis-aligned case when upright", () => {
    // theta = 0 is the base variant's obstacle exactly: a flat vertical face
    // flips vx and nothing else.
    const b = ball({ x: A.x - OBSTACLE_HW - BALL_R - 2, y: A.y, vx: 300 });
    const [left, right] = paddles();
    const events = step(b, left, right, only(0), FRAME);
    expect(events.obstacle).toBe(true);
    expect(b.vx).toBeCloseTo(-300, 6);
    expect(b.vy).toBeCloseTo(0, 6);
  });

  it("deflects a level shot off-axis when the face is tilted", () => {
    // The same horizontal shot at the same height, against a face turned 45deg.
    // An axis-aligned reflection could only ever flip vx and leave vy at zero,
    // so any real vertical component here is the tilt doing the work.
    const b = ball({ x: A.x - OBSTACLE_HW - BALL_R - 2, y: A.y, vx: 300 });
    const [left, right] = paddles();
    const events = step(b, left, right, only(Math.PI / 4), FRAME);
    expect(events.obstacle).toBe(true);
    expect(Math.abs(b.vy)).toBeGreaterThan(100);
    expect(ballSpeed(b)).toBeCloseTo(300, 6);
  });

  it("turns the deflection the other way when the tilt is the other way", () => {
    const shot = (theta: number): BallState => {
      const b = ball({ x: A.x - OBSTACLE_HW - BALL_R - 2, y: A.y, vx: 300 });
      const [left, right] = paddles();
      step(b, left, right, only(theta), FRAME);
      return b;
    };
    const up = shot(Math.PI / 4);
    const down = shot(-Math.PI / 4);
    expect(Math.sign(up.vy)).toBe(-Math.sign(down.vy));
  });

  it("preserves speed and spin through an oriented bounce", () => {
    const b = ball({
      x: A.x - OBSTACLE_HW - BALL_R - 2,
      y: A.y,
      vx: 300,
      spin: 100,
    });
    const [left, right] = paddles();
    step(b, left, right, only(Math.PI / 5), FRAME);
    expect(ballSpeed(b)).toBeCloseTo(300, 6);
    // Untouched by the bounce; only the per-step decay applies.
    expect(b.spin).toBeCloseTo(100 * Math.pow(0.5, FRAME / SPIN_HALFLIFE), 6);
  });

  it("leaves the ball clear of the obstacle it struck", () => {
    for (const theta of [0, 0.3, Math.PI / 4, 1.2, 2.5]) {
      const b = ball({ x: A.x - OBSTACLE_HW - BALL_R - 2, y: A.y, vx: 300 });
      const [left, right] = paddles();
      step(b, left, right, only(theta), FRAME);
      // Back into the obstacle's frame: the resolved center must sit at least a
      // ball radius from the rectangle, or the next frame re-triggers the hit.
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const dx = b.x - A.x;
      const dy = b.y - A.y;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const qx = Math.max(-OBSTACLE_HW, Math.min(OBSTACLE_HW, lx));
      const qy = Math.max(-OBSTACLE_HH, Math.min(OBSTACLE_HH, ly));
      expect(Math.hypot(lx - qx, ly - qy)).toBeGreaterThanOrEqual(
        BALL_R - 1e-6,
      );
    }
  });

  it("pushes a center that ended up inside the rectangle clear of the nearest face", () => {
    // Posed two units inside the long face of a tilted obstacle: the shallowest
    // way out is along that face's normal, and the ball ends BALL_R off it.
    const theta = 0.6;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const lx = OBSTACLE_HW - 2;
    const b = ball({ x: A.x + lx * cos, y: A.y + lx * sin, vx: 0, vy: 0 });
    const [left, right] = paddles();
    const events = step(b, left, right, only(theta), FRAME);
    expect(events.obstacle).toBe(true);
    const dx = b.x - A.x;
    const dy = b.y - A.y;
    expect(dx * cos + dy * sin).toBeCloseTo(OBSTACLE_HW + BALL_R, 6);
    expect(-dx * sin + dy * cos).toBeCloseTo(0, 6);
  });

  it("never tunnels through a tilted obstacle at the speed cap", () => {
    // 0.2 s at the speed cap is ~196 px of travel in ONE call — far enough to
    // step clean over a 20 px bar if the frame were integrated in one go. The
    // sub-stepping is what has to catch it, at every tilt.
    //
    // "Did not tunnel" is asserted as: the hit was registered, and the ball is
    // left properly outside the rectangle. It is NOT asserted as a final x on
    // the near side — a tilted face legitimately deflects the ball around and
    // past the obstacle's center line, which is the whole point of the variant.
    for (const theta of [0, 0.4, Math.PI / 4, 1.1]) {
      const b = ball({ x: A.x - 150, y: A.y, vx: SPEED_CAP });
      const [left, right] = paddles();
      const events = step(b, left, right, only(theta), 0.2);
      expect(events.obstacle).toBe(true);

      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const dx = b.x - A.x;
      const dy = b.y - A.y;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const qx = Math.max(-OBSTACLE_HW, Math.min(OBSTACLE_HW, lx));
      const qy = Math.max(-OBSTACLE_HH, Math.min(OBSTACLE_HH, ly));
      expect(Math.hypot(lx - qx, ly - qy)).toBeGreaterThan(0);
    }
  });

  it("catches the hit a single un-substepped frame would step clean over", () => {
    // The companion to the check above, stated as a difference: the same
    // interval delivered as many short frames must reach the same verdict as one
    // long one. A build that integrated once per frame would disagree here.
    const shot = (theta: number, frames: number): boolean => {
      const b = ball({ x: A.x - 150, y: A.y, vx: SPEED_CAP });
      const [left, right] = paddles();
      let hit = false;
      for (let i = 0; i < frames; i++) {
        hit = step(b, left, right, only(theta), 0.2 / frames).obstacle || hit;
      }
      return hit;
    };
    for (const theta of [0, Math.PI / 4]) {
      expect(shot(theta, 1)).toBe(true);
      expect(shot(theta, 48)).toBe(true);
    }
  });

  it("follows the obstacle: the same shot misses a swayed obstacle it would have hit", () => {
    const shot = (cy: number): boolean => {
      const b = ball({ x: A.x - 150, y: A.y, vx: 600 });
      const [left, right] = paddles();
      return step(b, left, right, only(0, cy), 0.35).obstacle;
    };
    expect(shot(A.y)).toBe(true);
    // Swayed a clear bar-length away, the same shot passes through where it was.
    expect(shot(A.y + 3 * OBSTACLE_HH)).toBe(false);
  });
});

describe("spin", () => {
  it("loses half its magnitude every SPIN_HALFLIFE seconds", () => {
    const b = ball({ spin: 800 });
    const [left, right] = paddles();
    step(b, left, right, UPRIGHT, SPIN_HALFLIFE);
    expect(b.spin).toBeCloseTo(400, 6);
  });

  it("curves the flight without changing the speed", () => {
    const b = ball({ x: 300, vx: 520, spin: 400 });
    const [left, right] = paddles();
    step(b, left, right, UPRIGHT, FRAME);
    expect(ballSpeed(b)).toBeCloseTo(520, 6);
    // Positive spin turns the velocity toward +y (down the screen).
    expect(b.vy).toBeGreaterThan(0);
  });

  it("curves the opposite way for the opposite sign", () => {
    const b = ball({ x: 300, vx: 520, spin: -400 });
    const [left, right] = paddles();
    step(b, left, right, UPRIGHT, FRAME);
    expect(b.vy).toBeLessThan(0);
  });
});
