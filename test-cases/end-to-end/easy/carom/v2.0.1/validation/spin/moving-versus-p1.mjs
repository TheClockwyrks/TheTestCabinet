// Automated validation for the Spin sub-item `moving-versus-p1`: player one's paddle
// (left, in Versus), swung as it strikes, imparts significant spin.
//
// The left paddle is posed moving UPWARD as a ball arrives; the real bounce imparts
// spin from the paddle's motion (physics.md: `spin += paddleVy * 0.85`). An upward
// swing curves the ball the opposite way from a downward one (negative spin), so this
// and its downward siblings together show up and down curving opposite ways.

import {
  arrangePaddleHit,
  actPaddleHit,
  startPlaying,
  LEAD_TICKS,
} from "../_helpers.mjs";

export default function item() {
  let hit;

  return {
    id: "spin.moving-versus-p1",

    // The contact sits at y=220 rather than mid-field so the upward swing has room to
    // be SEEN: over the half-second run-up a 720 px/s paddle covers 360 px, and
    // `arrangePaddleHit` starts it that far downstream (here cy 600, comfortably
    // inside the 665 bottom clamp) to arrive as the ball does. Aimed at mid-field the
    // swing would have to begin below the field edge, where the clamp would pin it
    // still and it would impart no spin at all. The lane at y=220 is clear of both
    // obstacles over the stretch the ball crosses, and the contact — a level ball
    // meeting a paddle sweeping up through it — is the same one the check always made.
    async arrange(api) {
      await startPlaying(api, "versus");
      await arrangePaddleHit(api, "left", {
        cy: 240,
        vy: -720,
        ballY: 220,
        leadTicks: LEAD_TICKS,
      });
    },

    async act(api) {
      hit = await actPaddleHit(api, "left", { leadTicks: LEAD_TICKS });
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
