// Automated validation for the Ball sub-item `bounces`: the ball reflects off BOTH
// fixed mid-field obstacles (enabling bank shots), staying on the incoming side of
// the struck face.
//
// Each shot's start position and velocity are preconditions; the reflection is
// produced by the real collision code, read back from the snapshot. One assertion
// per obstacle records that it reflected and stayed on the near side.

import { clearPaddles, startPlaying, TICK } from "../_helpers.mjs";

// Obstacle A: x [480,500], y [150,290]. Obstacle B: x [780,800], y [430,570].
const OBSTACLE_A = { faceX: 480, y: 220 };
const OBSTACLE_B = { faceX: 780, y: 500 };

const SPEED = 600;

// ARRANGE half of a bank shot: line the ball up 180 px short of an obstacle's left
// face, level with the face so the approach is a straight-on hit. Control ops only,
// so it is callable from either phase — which matters, because the second shot has to
// be re-posed inside `act` after the first has run.
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

// ACT half of a bank shot: run the real collision code until the ball reflects
// (vx < 0). Polls one tick at a time because the instant of the rebound is exactly
// what the near-side assertion reads. 240 ticks = the old 2s cap.
function actBankOff(api) {
  return api.until((s) => s.balls[0].vx < 0, { max: 240, poll: TICK });
}

export default function item() {
  let a;
  let b;

  return {
    id: "ball.bounces",

    // A live match with the first bank shot — obstacle A — already lined up.
    async arrange(api) {
      await startPlaying(api);
      await arrangeBankOff(api, OBSTACLE_A, SPEED);
    },

    // Both bank shots, back to back: that pair IS the clip, and it shows the reviewer
    // the same two reflections the assertions read. The second shot is re-posed here
    // with control ops alone — deliberately NOT via `startPlaying`, which leads with a
    // `reset` and would take the build off the clock the runtime just handed it
    // (specs/instrumentation.md: reset and step both switch to manual stepping). A
    // bank shot never leaves the field, so no reset is needed between the two.
    async act(api) {
      a = await actBankOff(api);

      await arrangeBankOff(api, OBSTACLE_B, SPEED);
      b = await actBankOff(api);

      // A short tail so the clip ends on the ball travelling back out rather than on
      // the single frame it reversed. 60 ticks (0.5s) keeps it inside the field.
      await api.advance(60);
    },

    async assert(api, check) {
      check.expectOk("reflects off obstacle A (vx reverses)", a.hit);
      check.expectLt(
        "stays on the near side of obstacle A (x)",
        a.snap.balls[0].x,
        OBSTACLE_A.faceX,
      );

      check.expectOk("reflects off obstacle B (vx reverses)", b.hit);
      check.expectLt(
        "stays on the near side of obstacle B (x)",
        b.snap.balls[0].x,
        OBSTACLE_B.faceX,
      );
    },
  };
}
