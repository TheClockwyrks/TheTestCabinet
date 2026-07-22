// Automated validation for the Ball sub-item `bounce-a-left`: the ball reflects off
// the LEFT face of the near mid-field obstacle (A), so a bank shot works from that
// side.
//
// The ball is fired level with obstacle A, straight at its left face; the real
// collision code reflects it. It must reverse its horizontal direction and stay on
// the near (left) side of the struck face. The other three faces are covered by the
// sibling `bounce-a-right`, `bounce-b-left`, and `bounce-b-right` checks.

import {
  arrangeObstacleBounce,
  actObstacleBounce,
  startPlaying,
  OBSTACLE_A,
} from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "ball.bounce-a-left",

    async arrange(api) {
      await startPlaying(api);
      await arrangeObstacleBounce(api, {
        faceX: OBSTACLE_A.x0,
        y: OBSTACLE_A.y,
        from: "left",
      });
    },

    // Run the real collision until the ball rebounds; a short tail so the clip ends on
    // the ball travelling back out rather than the single frame it reversed.
    async act(api) {
      r = await actObstacleBounce(api, "left");
      await api.advance(60);
    },

    async assert(api, check) {
      check.expectOk("the ball reflects off obstacle A's left face", r.hit);
      check.expectLt(
        "the ball stays on the near (left) side of the face (x)",
        r.snap.balls[0].x,
        OBSTACLE_A.x0,
      );
    },
  };
}
