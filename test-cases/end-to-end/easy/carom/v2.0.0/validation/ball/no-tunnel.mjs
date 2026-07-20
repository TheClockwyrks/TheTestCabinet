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
  FIELD_H,
  SPEED_CAP,
  TICK,
} from "../_helpers.mjs";

const OBSTACLE_A = { faceX: 480, y: 220 };

// 36 ticks = the old 0.3s cap on each rebound. At the ceiling speed every one of
// these contacts lands well inside that, so a miss is a real tunnelling failure
// rather than a sweep that ran short.
const REBOUND_MAX = 36;

// ARRANGE half of the obstacle probe: line the ball up 180 px short of the obstacle's
// left face and level with it. Control ops only, so it is callable from either phase.
async function arrangeBankOff(api, obstacle, speed) {
  await clearPaddles(api);
  await api.call("setBall", 0, {
    x: obstacle.faceX - 180,
    y: obstacle.y,
    vx: speed,
    vy: 0,
    spin: 0,
  });
}

export default function item() {
  let fastObstacle;
  let paddle;
  let wall;

  return {
    id: "ball.no-tunnel",

    // A live match with the first probe — the obstacle, at the ceiling speed — lined
    // up. The paddle and wall probes are re-posed inside `act`, after this one has run.
    async arrange(api) {
      await startPlaying(api);
      await arrangeBankOff(api, OBSTACLE_A, SPEED_CAP);
    },

    // All three ceiling-speed contacts, back to back: obstacle, paddle, wall. That
    // sequence IS the clip, and it is exactly the three rebounds the assertions read.
    // Each probe is re-posed with control ops alone — deliberately NOT via
    // `startPlaying`, which leads with a `reset` and would take the build off the clock
    // the runtime just handed it (specs/instrumentation.md: reset and step both switch
    // to manual stepping). None of these shots leaves the field, so nothing scores
    // between them and no reset is needed.
    async act(api) {
      // Obstacle at the ceiling speed: must reflect and stay left of the obstacle.
      // Polls one tick because the near-side reading is taken at the rebound instant.
      fastObstacle = await api.until((s) => s.balls[0].vx < 0, {
        max: REBOUND_MAX,
        poll: TICK,
      });

      // Paddle at the ceiling speed straight at the left paddle: must rebound, not
      // score. The right paddle is parked out of the lane so it cannot interfere.
      await api.call("setPaddle", "left", { cy: 360, vy: 0 });
      await api.call("setPaddle", "right", { cy: 150, vy: 0 });
      await api.call("setBall", 0, {
        x: 300,
        y: 360,
        vx: -SPEED_CAP,
        vy: 0,
        spin: 0,
      });
      paddle = await api.until((s) => s.balls[0].vx > 0, {
        max: REBOUND_MAX,
        poll: TICK,
      });

      // Wall at the ceiling speed straight at the top wall: must rebound, stay in field.
      await clearPaddles(api);
      await api.call("setBall", 0, {
        x: 640,
        y: 100,
        vx: 0,
        vy: -SPEED_CAP,
        spin: 0,
      });
      wall = await api.until((s) => s.balls[0].vy > 0, {
        max: REBOUND_MAX,
        poll: TICK,
      });

      // A short tail so the clip ends on the ball travelling away from the wall rather
      // than on the single frame it reversed. 60 ticks (0.5s) keeps it inside the field.
      await api.advance(60);
    },

    async assert(api, check) {
      check.expectOk(
        "at the ceiling speed the ball rebounds off an obstacle (vx reverses)",
        fastObstacle.hit,
      );
      check.expectLt(
        "at the ceiling speed the ball does not tunnel through the obstacle (x)",
        fastObstacle.snap.balls[0].x,
        OBSTACLE_A.faceX,
      );

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
    },
  };
}
