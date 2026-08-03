// Automated validation for the Spin sub-item `moving-versus-p2`: player two's paddle
// (right, in Versus), swung as it strikes, imparts significant spin.
//
// The right paddle is posed moving DOWNWARD as a ball arrives from the left; the real
// bounce imparts spin from the paddle's motion (physics.md: `spin += paddleVy *
// 0.85`), curving the ball's flight.

import {
  arrangePaddleHit,
  actPaddleHit,
  startPlaying,
  LEAD_TICKS,
} from "../_helpers.mjs";

export default function item() {
  let hit;

  return {
    id: "spin.moving-versus-p2",

    // The contact sits at y=500 rather than mid-field so the downward swing has room
    // to be SEEN: over the half-second run-up a 720 px/s paddle covers 360 px, and
    // `arrangePaddleHit` starts it that far upstream (here cy 120, comfortably inside
    // the 55 top clamp) to arrive as the ball does. Aimed at mid-field the swing would
    // have to begin above the field edge, where the clamp would pin it still and it
    // would impart no spin at all. The lane at y=500 is clear of both obstacles over
    // the stretch the ball crosses, and the contact — a level ball meeting a paddle
    // sweeping down through it — is the same one the check always made.
    async arrange(api) {
      await startPlaying(api, "versus");
      await arrangePaddleHit(api, "right", {
        cy: 480,
        vy: 720,
        ballY: 500,
        leadTicks: LEAD_TICKS,
      });
    },

    async act(api) {
      hit = await actPaddleHit(api, "right", { leadTicks: LEAD_TICKS });
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
