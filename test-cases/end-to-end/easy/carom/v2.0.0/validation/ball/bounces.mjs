// Automated validation for the Ball sub-item `bounces`: the ball reflects off BOTH
// fixed mid-field obstacles (enabling bank shots), staying on the incoming side of
// the struck face.
//
// Each shot's start position and velocity are preconditions; the reflection is
// produced by the real collision code, read back from the snapshot.

import { clearPaddles, startPlaying, stepUntil } from "../_helpers.mjs";

// Obstacle A: x [480,500], y [150,290]. Obstacle B: x [780,800], y [430,570].
const OBSTACLE_A = { faceX: 480, y: 220 };
const OBSTACLE_B = { faceX: 780, y: 500 };

// Fire a ball rightward at an obstacle's left face; step until it reflects (vx<0).
async function bankOff(api, obstacle, speed, maxSeconds) {
  await clearPaddles(api);
  await api.call("setBall", 0, {
    x: obstacle.faceX - 180,
    y: obstacle.y,
    vx: speed,
    vy: 0,
    spin: 0,
  });
  return stepUntil(api, (s) => s.balls[0].vx < 0, maxSeconds);
}

export default async function drive(api) {
  // Reflect off both obstacles at a normal speed.
  await startPlaying(api);
  const a = await bankOff(api, OBSTACLE_A, 600, 2);
  await startPlaying(api);
  const b = await bankOff(api, OBSTACLE_B, 600, 2);
  const pass =
    a.hit &&
    a.snap.balls[0].x < OBSTACLE_A.faceX &&
    b.hit &&
    b.snap.balls[0].x < OBSTACLE_B.faceX;

  // A clip: a moderate bank shot reflecting off an obstacle.
  await startPlaying(api);
  await clearPaddles(api);
  await api.call("setBall", 0, { x: 300, y: 220, vx: 560, vy: 80, spin: 0 });
  await api.wait(1600);

  return {
    verdicts: { "ball.bounces": pass },
    notes: {
      "ball.bounces": `A reflect x=${a.snap.balls[0].x.toFixed(0)}<480, B reflect x=${b.snap.balls[0].x.toFixed(0)}<780`,
    },
  };
}
