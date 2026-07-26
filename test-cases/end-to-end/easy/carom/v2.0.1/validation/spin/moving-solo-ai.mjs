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
      // The spin imparted must TRACK the AI paddle's own motion (physics.md:
      // `spin += paddleVy * 0.85`), not clear a fixed magnitude. The AI is deliberately
      // slower than the human (560 vs 720 px/s) and eases off as it nears the ball, so
      // its contact speed — and thus its spin — is whatever its own chase produces. A
      // fixed floor tuned to a hard human swing (spin > 400 needs vy > ~470) rejects a
      // conformant, gentler AI that still applies the spin mechanic correctly. Reading
      // spin against the paddle's actual vy is robust to how fast the AI happens to be
      // moving while still catching a build that imparts no (or wrong) spin.
      const expectedSpin = hit.paddle.vy * 0.85;
      check.expectClose(
        "its motion imparts spin tracking the paddle's speed (spin ≈ vy × 0.85)",
        hit.ball.spin,
        expectedSpin,
        Math.max(50, expectedSpin * 0.25),
      );
    },
  };
}
