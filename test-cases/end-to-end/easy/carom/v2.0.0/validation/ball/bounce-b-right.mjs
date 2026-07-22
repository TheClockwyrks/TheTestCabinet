// Automated validation for the Ball sub-item `bounce-b-right`: the ball reflects off
// the RIGHT face of the far mid-field obstacle (B).
//
// The ball is fired level with obstacle B, straight at its right face from the right;
// the real collision code reflects it. It must reverse its horizontal direction and
// stay on the near (right) side of the struck face.

import {
  arrangeObstacleBounce,
  actObstacleBounce,
  startPlaying,
  OBSTACLE_B,
} from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "ball.bounce-b-right",

    async arrange(api) {
      await startPlaying(api);
      await arrangeObstacleBounce(api, {
        faceX: OBSTACLE_B.x1,
        y: OBSTACLE_B.y,
        from: "right",
      });
    },

    async act(api) {
      r = await actObstacleBounce(api, "right");
      await api.advance(60);
    },

    async assert(api, check) {
      check.expectOk("the ball reflects off obstacle B's right face", r.hit);
      check.expectGt(
        "the ball stays on the near (right) side of the face (x)",
        r.snap.balls[0].x,
        OBSTACLE_B.x1,
      );
    },
  };
}
