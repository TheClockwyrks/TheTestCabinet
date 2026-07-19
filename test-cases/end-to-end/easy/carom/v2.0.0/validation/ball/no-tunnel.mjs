// Automated validation for the Ball sub-item `no-tunnel`: at the fastest the ball
// can ever travel in real play, it still never passes through an obstacle, a paddle,
// or a wall — the swept/sub-stepped integrator keeps it out.
//
// The probe speed is SPEED_CAP (980 px/s), the largest the spec allows: a paddle
// bounce is capped at `min(speed * 1.04, 980)` and nothing else raises speed, so a
// real rally can reach this and no more. Testing at the ceiling checks exactly what
// the spec requires the integrator to survive, rather than an impossible value no
// build is obliged to handle.
//
// Each shot's start position and velocity are preconditions; the reflection is
// produced by the real collision code, read back from the snapshot.

import {
  clearPaddles,
  startPlaying,
  stepUntil,
  FIELD_H,
  SPEED_CAP,
} from "../_helpers.mjs";

const OBSTACLE_A = { faceX: 480, y: 220 };

// Fire a ball rightward at the obstacle's left face; step until it reflects (vx<0).
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

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ball.no-tunnel");

  // Obstacle at the ceiling speed: must reflect and stay left of the obstacle.
  await startPlaying(api);
  const fastObstacle = await bankOff(api, OBSTACLE_A, SPEED_CAP, 0.3);
  check.expectOk(
    "at the ceiling speed the ball rebounds off an obstacle (vx reverses)",
    fastObstacle.hit,
  );
  check.expectLt(
    "at the ceiling speed the ball does not tunnel through the obstacle (x)",
    fastObstacle.snap.balls[0].x,
    OBSTACLE_A.faceX,
  );

  // Paddle at the ceiling speed straight at the left paddle: must rebound, not score.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, {
    x: 300,
    y: 360,
    vx: -SPEED_CAP,
    vy: 0,
    spin: 0,
  });
  const paddle = await stepUntil(api, (s) => s.balls[0].vx > 0, 0.3);
  check.expectOk(
    "at the ceiling speed the ball rebounds off a paddle (vx reverses)",
    paddle.hit,
  );
  check.expectEq(
    "the ball did not score through the paddle (screen)",
    paddle.snap.screen,
    "playing",
  );
  check.expectGt(
    "at the ceiling speed the ball does not pass through the paddle (x)",
    paddle.snap.balls[0].x,
    0,
  );

  // Wall at the ceiling speed straight at the top wall: must rebound, stay in field.
  await startPlaying(api);
  await clearPaddles(api);
  await api.call("setBall", 0, {
    x: 640,
    y: 100,
    vx: 0,
    vy: -SPEED_CAP,
    spin: 0,
  });
  const wall = await stepUntil(api, (s) => s.balls[0].vy > 0, 0.3);
  check.expectOk(
    "at the ceiling speed the ball rebounds off a wall (vy reverses)",
    wall.hit,
  );
  check.expectGt(
    "the ball stays below the top wall (y)",
    wall.snap.balls[0].y,
    0,
  );
  check.expectLt(
    "the ball stays inside the field (y)",
    wall.snap.balls[0].y,
    FIELD_H,
  );

  // A clip: a top-speed shot rebounding off an obstacle without passing through.
  await startPlaying(api);
  await clearPaddles(api);
  await api.call("setBall", 0, {
    x: 300,
    y: 220,
    vx: SPEED_CAP,
    vy: 0,
    spin: 0,
  });
  await api.call("setAutoStep", true); // hand the clock back so the clip animates
  await api.wait(1400);

  return check.verdict();
}
