// Automated validation for the `obstacle-bank` review item (sub-items: bounces,
// no-tunnel).
//
// bounces:   the ball reflects off BOTH fixed mid-field obstacles (enabling bank
//            shots), staying on the incoming side of the struck face.
// no-tunnel: even at extreme speed the ball never passes through an obstacle, a
//            paddle, or a wall — the swept/sub-stepped integrator keeps it out.
//
// Each shot's start position and velocity are preconditions; the reflection is
// produced by the real collision code, read back from the snapshot.

import { clearPaddles, startPlaying, stepUntil, FIELD_H } from "./_helpers.mjs";

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
  // --- bounces: reflect off both obstacles at a normal speed ---
  await startPlaying(api);
  const a = await bankOff(api, OBSTACLE_A, 600, 2);
  await startPlaying(api);
  const b = await bankOff(api, OBSTACLE_B, 600, 2);
  const bouncesPass =
    a.hit &&
    a.snap.balls[0].x < OBSTACLE_A.faceX &&
    b.hit &&
    b.snap.balls[0].x < OBSTACLE_B.faceX;

  // --- no-tunnel: extreme speed against an obstacle, a paddle, and a wall ---
  // Obstacle at ~6000 px/s: must reflect and stay left of the obstacle.
  await startPlaying(api);
  const fastObstacle = await bankOff(api, OBSTACLE_A, 6000, 0.3);
  const obstacleHeld =
    fastObstacle.hit && fastObstacle.snap.balls[0].x < OBSTACLE_A.faceX;

  // Paddle at ~6000 px/s straight at the left paddle: must rebound, not score.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, { x: 300, y: 360, vx: -6000, vy: 0, spin: 0 });
  const paddle = await stepUntil(api, (s) => s.balls[0].vx > 0, 0.3);
  const paddleHeld =
    paddle.hit &&
    paddle.snap.screen === "playing" &&
    paddle.snap.balls[0].x > 0;

  // Wall at ~6000 px/s straight at the top wall: must rebound, stay in the field.
  await startPlaying(api);
  await clearPaddles(api);
  await api.call("setBall", 0, { x: 640, y: 100, vx: 0, vy: -6000, spin: 0 });
  const wall = await stepUntil(api, (s) => s.balls[0].vy > 0, 0.3);
  const wallHeld =
    wall.hit && wall.snap.balls[0].y > 0 && wall.snap.balls[0].y < FIELD_H;

  const noTunnelPass = obstacleHeld && paddleHeld && wallHeld;

  // A clip: a moderate bank shot off an obstacle.
  await startPlaying(api);
  await clearPaddles(api);
  await api.call("setBall", 0, { x: 300, y: 220, vx: 560, vy: 80, spin: 0 });
  await api.wait(1600);

  // Verdict ids are the item's composite sub-item ids (<item>.<sub-item>).
  return {
    verdicts: {
      "obstacle-bank.bounces": bouncesPass,
      "obstacle-bank.no-tunnel": noTunnelPass,
    },
    notes: {
      "obstacle-bank.bounces": `A reflect x=${a.snap.balls[0].x.toFixed(0)}<480, B reflect x=${b.snap.balls[0].x.toFixed(0)}<780`,
      "obstacle-bank.no-tunnel": `obstacle held=${obstacleHeld} (x=${fastObstacle.snap.balls[0].x.toFixed(0)}), paddle held=${paddleHeld}, wall held=${wallHeld} — all at ~6000px/s`,
    },
  };
}
