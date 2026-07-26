// Automated validation for the Spin sub-item `moving-solo-ai`: the AI opponent's
// paddle (right, in Solo), moving as it strikes, imparts spin just as a human paddle
// does.
//
// The real AI is handed control of its paddle (setAiControl) and a ball is aimed to
// arrive while the AI is still sweeping down the field to intercept it, so the AI
// strikes while its paddle is moving. The real bounce imparts spin from that motion
// (physics.md: `spin += paddleVy * 0.85`) — nothing poses the AI's velocity; its own
// chase is what curves the ball. See validation/_helpers.mjs.

import { arrangeAiMovingHit, actPaddleHit } from "../_helpers.mjs";

export default function item() {
  let hit;

  return {
    id: "spin.moving-solo-ai",

    async arrange(api) {
      await arrangeAiMovingHit(api);
    },

    async act(api) {
      hit = await actPaddleHit(api, "right");
      await api.advance(96); // 0.8 s of visible curve
    },

    async assert(api, check) {
      check.expectOk("the moving AI paddle contacts the ball", hit.hit);
      check.expectGt(
        "the AI paddle is moving down as it strikes (vy)",
        hit.paddle.vy,
        100,
      );
      check.expectGt(
        "its motion imparts significant spin to the ball (spin)",
        hit.ball.spin,
        400,
      );
    },
  };
}
