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
  pinObstaclesUpright,
  startPlaying,
  FIELD_H,
  SPEED_CAP,
  TICK,
  ball0,
} from "../_helpers.mjs";

const OBSTACLE_A = { faceX: 480, y: 220 };

// Each probe's sweep cap, in ticks: its run-up (below) plus room for the contact
// itself. At the ceiling speed every one of these lands well inside its cap, so a
// miss is a real tunnelling failure rather than a sweep that ran short.
const OBSTACLE_MAX = 60; // ~43 ticks of run-up
const PADDLE_MAX = 108; // ~84 ticks of run-up
const WALL_MAX = 96; // ~72 ticks of run-up

// How long each probe holds AFTER its rebound, so the clip shows the ball travelling
// away from what it just bounced off. Every one is sized to keep the ball inside the
// field: none reaches a goal or the far wall before the next probe is set up.
const OBSTACLE_TAIL = 36; // 0.30 s
const PADDLE_TAIL = 48; // 0.40 s
const WALL_TAIL = 60; // 0.50 s

// A beat with the ball posed and STILL between probes. Three back-to-back contacts
// read as one continuous flight — the ball appearing to jump the field at ceiling
// speed, which is exactly what this item exists to disprove. Placing it, letting it
// sit, and only then launching makes each probe legible as its own shot.
const GAP = 24; // 0.20 s

// The distance each probe's ball is placed short of what it will strike. Long enough
// to film as an approach (roughly half a second at the ceiling speed), and short
// enough that the whole run-up fits on the field ahead of the contact.
const OBSTACLE_RUN_UP = 360;
const PADDLE_START_X = 760; // 685 px short of the left paddle's face
const WALL_START_Y = 600; // 589 px below the top wall

// ARRANGE half of the obstacle probe: line the ball up short of the obstacle's left
// face and level with it. Control ops only, so it is callable from either phase.
async function arrangeBankOff(api, obstacle, speed) {
  await clearPaddles(api);
  await api.call("setBall", 0, {
    x: obstacle.faceX - OBSTACLE_RUN_UP,
    y: obstacle.y,
    vx: speed,
    vy: 0,
    spin: 0,
  });
}

// Pose the next probe's ball at rest, hold there for a beat, then launch it at `v`
// ({vx, vy}) from that same spot — so the clip separates this shot from the one before
// it and the launch itself is visible. Every pose restates the full ball state rather
// than patching one field, so a build is never relied on to merge a partial update.
async function placeThenLaunch(api, { x, y }, v) {
  const at = { x, y, spin: 0 };
  await api.call("setBall", 0, { ...at, vx: 0, vy: 0 });
  await api.advance(GAP);
  await api.call("setBall", 0, { ...at, vx: 0, vy: 0, ...v });
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
      // The obstacle probe fires at obstacle A's base-x left face; pin the gyre
      // obstacles upright so that face sits where the assertion expects (a no-op in
      // base/multi and for an already-upright build).
      await pinObstaclesUpright(api);
      await arrangeBankOff(api, OBSTACLE_A, SPEED_CAP);
    },

    // All three ceiling-speed contacts, in turn: obstacle, paddle, wall. That sequence
    // IS the clip, and it is exactly the three rebounds the assertions read. Each probe
    // gets a run-up, its contact, and a tail travelling away, with the ball posed still
    // for a beat in between — so a reviewer sees three separate shots each arrive at
    // something solid and come back off it. Filmed nose-to-tail without those breaks
    // the same three rebounds read as one ball ricocheting around the field faster than
    // the eye can follow, which looks like the tunnelling this item disproves.
    //
    // Each probe is re-posed with control ops alone — deliberately NOT via
    // `startPlaying`, which leads with a `reset` and would take the build off the clock
    // the runtime just handed it (specs/instrumentation.md: reset and step both switch
    // to manual stepping). None of these shots leaves the field, so nothing scores
    // between them and no reset is needed.
    async act(api) {
      // Obstacle at the ceiling speed: must reflect and stay left of the obstacle.
      // Polls one tick because the near-side reading is taken at the rebound instant.
      fastObstacle = await api.until((s) => ball0(s).vx < 0, {
        max: OBSTACLE_MAX,
        poll: TICK,
      });
      await api.advance(OBSTACLE_TAIL);

      // Paddle at the ceiling speed straight at the left paddle: must rebound, not
      // score. The right paddle is parked out of the lane so it cannot interfere, and
      // the run-up down the y=360 lane clears both obstacles.
      await api.call("setPaddle", "left", { cy: 360, vy: 0 });
      await api.call("setPaddle", "right", { cy: 150, vy: 0 });
      await placeThenLaunch(
        api,
        { x: PADDLE_START_X, y: 360 },
        { vx: -SPEED_CAP },
      );
      paddle = await api.until((s) => ball0(s).vx > 0, {
        max: PADDLE_MAX,
        poll: TICK,
      });
      await api.advance(PADDLE_TAIL);

      // Wall at the ceiling speed straight at the top wall: must rebound, stay in field.
      // The climb runs up the field's center line, clear of both obstacles.
      await clearPaddles(api);
      await placeThenLaunch(
        api,
        { x: 640, y: WALL_START_Y },
        { vy: -SPEED_CAP },
      );
      wall = await api.until((s) => ball0(s).vy > 0, {
        max: WALL_MAX,
        poll: TICK,
      });

      // A tail so the clip ends on the ball travelling away from the wall rather than
      // on the single frame it reversed, and stays inside the field doing it.
      await api.advance(WALL_TAIL);
    },

    async assert(api, check) {
      check.expectOk(
        "at the ceiling speed the ball rebounds off an obstacle (vx reverses)",
        fastObstacle.hit,
      );
      check.expectLt(
        "at the ceiling speed the ball does not tunnel through the obstacle (x)",
        ball0(fastObstacle.snap).x,
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
        ball0(paddle.snap).x,
        0,
      );

      check.expectOk(
        "at the ceiling speed the ball rebounds off a wall (vy reverses)",
        wall.hit,
      );
      check.expectGt(
        "the ball stays below the top wall (y)",
        ball0(wall.snap).y,
        0,
      );
      check.expectLt(
        "the ball stays inside the field (y)",
        ball0(wall.snap).y,
        FIELD_H,
      );
    },
  };
}
