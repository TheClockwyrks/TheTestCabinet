// Automated validation for the Spin sub-item `moving-solo-player`: the human paddle
// (left, in Solo), swung as it strikes, imparts significant spin that curves the
// ball's flight.
//
// The left paddle is posed moving DOWNWARD as a ball arrives; the real bounce imparts
// spin from the paddle's motion (physics.md: `spin += paddleVy * 0.85`). A downward
// swing curves the ball one way (positive spin). The upward direction is covered by
// the Versus player-one sibling, so the suite as a whole shows both.

import {
  arrangePaddleHit,
  actPaddleHit,
  actCurveOffset,
  assertCurved,
  startPlaying,
  LEAD_TICKS,
} from "../_helpers.mjs";

export default function item() {
  let hit;
  let curve;

  return {
    id: "spin.moving-solo-player",

    // The contact sits at y=500 rather than mid-field so the downward swing has room
    // to be SEEN: over the half-second run-up a 720 px/s paddle covers 360 px, and
    // `arrangePaddleHit` starts it that far upstream (here cy 120, comfortably inside
    // the 55 top clamp) to arrive as the ball does. Aimed at mid-field the swing would
    // have to begin above the field edge, where the clamp would pin it still and it
    // would impart no spin at all. The lane at y=500 is clear of both obstacles over
    // the stretch the ball crosses, and the contact — a level ball meeting a paddle
    // sweeping down through it — is the same one the check always made.
    async arrange(api) {
      await startPlaying(api, "solo");
      await arrangePaddleHit(api, "left", {
        cy: 480,
        vy: 720,
        ballY: 500,
        leadTicks: LEAD_TICKS,
      });
    },

    async act(api) {
      hit = await actPaddleHit(api, "left", { leadTicks: LEAD_TICKS });
      // Fly the return on and measure how far it bends off the line it left the
      // paddle on. The window stops short of the bottom wall the curve is heading
      // for — the offset is measured against free flight, and a bounce inside it
      // would reflect the very line it is measured against.
      curve = await actCurveOffset(api, 72); // 0.6 s of measured curve
      // The rest of the old 96-tick tail, so the clip still shows the curve running on.
      await api.advance(24);
    },

    async assert(api, check) {
      check.expectOk("the downward-swung paddle contacts the ball", hit.hit);
      check.expectGt(
        "a downward swing imparts significant positive spin (spin)",
        hit.ball.spin,
        400,
      );
      assertCurved(check, curve, {
        who: "the shot off the swung human paddle",
      });
    },
  };
}
