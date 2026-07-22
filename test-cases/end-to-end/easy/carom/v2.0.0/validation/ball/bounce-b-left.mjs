// Automated validation for the Ball sub-item `bounce-b-left`: the ball reflects off
// the LEFT face of the far mid-field obstacle (B).
//
// The ball is fired level with obstacle B, straight at its left face; the real
// collision code reflects it. It must reverse its horizontal direction and stay on
// the near (left) side of the struck face.

import {
  arrangeObstacleBounce,
  actObstacleBounce,
  startPlaying,
  OBSTACLE_B,
} from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "ball.bounce-b-left",

    async arrange(api) {
      await startPlaying(api);
      await arrangeObstacleBounce(api, {
        faceX: OBSTACLE_B.x0,
        y: OBSTACLE_B.y,
        from: "left",
      });
    },

    async act(api) {
      r = await actObstacleBounce(api, "left");
      await api.advance(60);
    },

    async assert(api, check) {
      check.expectOk("the ball reflects off obstacle B's left face", r.hit);
      check.expectLt(
        "the ball stays on the near (left) side of the face (x)",
        r.snap.balls[0].x,
        OBSTACLE_B.x0,
      );
    },
  };
}
