// Automated validation for the Spin sub-item `moving-versus-p2`: player two's paddle
// (right, in Versus), swung as it strikes, imparts significant spin.
//
// The right paddle is posed moving DOWNWARD as a ball arrives from the left; the real
// bounce imparts spin from the paddle's motion (physics.md: `spin += paddleVy *
// 0.85`), curving the ball's flight.

import { arrangePaddleHit, actPaddleHit, startPlaying } from "../_helpers.mjs";

export default function item() {
  let hit;

  return {
    id: "spin.moving-versus-p2",

    async arrange(api) {
      await startPlaying(api, "versus");
      await arrangePaddleHit(api, "right", { cy: 340, vy: 720, ballY: 360 });
    },

    async act(api) {
      hit = await actPaddleHit(api, "right");
      await api.advance(96); // 0.8 s of visible curve
    },

    async assert(api, check) {
      check.expectOk("the downward-swung paddle contacts the ball", hit.hit);
      check.expectGt(
        "a downward swing imparts significant positive spin (spin)",
        hit.ball.spin,
        400,
      );
    },
  };
}
