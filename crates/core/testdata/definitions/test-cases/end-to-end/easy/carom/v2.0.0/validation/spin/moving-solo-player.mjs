// Automated validation for the Spin sub-item `moving-solo-player`: the human paddle
// (left, in Solo), swung as it strikes, imparts significant spin that curves the
// ball's flight.
//
// The left paddle is posed moving DOWNWARD as a ball arrives; the real bounce imparts
// spin from the paddle's motion (physics.md: `spin += paddleVy * 0.85`). A downward
// swing curves the ball one way (positive spin). The upward direction is covered by
// the Versus player-one sibling, so the suite as a whole shows both.

import { arrangePaddleHit, actPaddleHit, startPlaying } from "../_helpers.mjs";

export default function item() {
  let hit;

  return {
    id: "spin.moving-solo-player",

    async arrange(api) {
      await startPlaying(api, "solo");
      await arrangePaddleHit(api, "left", { cy: 340, vy: 720, ballY: 360 });
    },

    async act(api) {
      hit = await actPaddleHit(api, "left");
      // Let the return fly on, so the clip shows the curve the spin produces.
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
