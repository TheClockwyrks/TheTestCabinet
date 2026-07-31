// Automated validation for the Spin sub-item `moving-versus-p1`: player one's paddle
// (left, in Versus), swung as it strikes, imparts significant spin.
//
// The left paddle is posed moving UPWARD as a ball arrives; the real bounce imparts
// spin from the paddle's motion (physics.md: `spin += paddleVy * 0.85`). An upward
// swing curves the ball the opposite way from a downward one (negative spin), so this
// and its downward siblings together show up and down curving opposite ways.

import { arrangePaddleHit, actPaddleHit, startPlaying } from "../_helpers.mjs";

export default function item() {
  let hit;

  return {
    id: "spin.moving-versus-p1",

    async arrange(api) {
      await startPlaying(api, "versus");
      await arrangePaddleHit(api, "left", { cy: 380, vy: -720, ballY: 360 });
    },

    async act(api) {
      hit = await actPaddleHit(api, "left");
      await api.advance(96); // 0.8 s of visible curve
    },

    async assert(api, check) {
      check.expectOk("the upward-swung paddle contacts the ball", hit.hit);
      check.expectLt(
        "an upward swing imparts significant negative spin (spin)",
        hit.ball.spin,
        -400,
      );
    },
  };
}
