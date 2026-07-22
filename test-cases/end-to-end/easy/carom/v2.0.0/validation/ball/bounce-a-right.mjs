// Automated validation for the Ball sub-item `bounce-a-right`: the ball reflects off
// the RIGHT face of the near mid-field obstacle (A).
//
// The ball is fired level with obstacle A, straight at its right face from the right;
// the real collision code reflects it. It must reverse its horizontal direction and
// stay on the near (right) side of the struck face.

import {
  arrangeObstacleBounce,
  actObstacleBounce,
  startPlaying,
  OBSTACLE_A,
} from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "ball.bounce-a-right",

    async arrange(api) {
      await startPlaying(api);
      await arrangeObstacleBounce(api, {
        faceX: OBSTACLE_A.x1,
        y: OBSTACLE_A.y,
        from: "right",
      });
    },

    async act(api) {
      r = await actObstacleBounce(api, "right");
      await api.advance(60);
    },

    async assert(api, check) {
      check.expectOk("the ball reflects off obstacle A's right face", r.hit);
      check.expectGt(
        "the ball stays on the near (right) side of the face (x)",
        r.snap.balls[0].x,
        OBSTACLE_A.x1,
      );
    },
  };
}
