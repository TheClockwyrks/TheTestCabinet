// Automated validation for the Paddles sub-item `hit-center`.
//
// Hitting the CENTER of a stationary paddle sends the ball straight across, with no
// vertical angle. The outgoing angle comes from the contact point on a stationary
// paddle (physics.md: `offset = (ballY - paddleCy) / 55`, `theta = offset * 55deg`),
// so a contact level with the paddle center returns straight. The paddle pose and
// contact height are preconditions; the real bounce produces the outgoing velocity we
// read back. The steep edge case is the sibling `hit-edge` check.

import {
  arrangeLeftPaddleHit,
  actLeftPaddleHit,
  startPlaying,
  LEAD_TICKS,
} from "../_helpers.mjs";

function angleDeg(ball) {
  return (Math.atan2(Math.abs(ball.vy), Math.abs(ball.vx)) * 180) / Math.PI;
}

export default function item() {
  let center;

  return {
    id: "paddles.hit-center",

    // Center: ball level with the paddle center -> straight across (vy ~ 0). The
    // paddle is stationary (vy 0) so the outgoing angle comes purely from the contact
    // point, with no spin from paddle motion mixed in.
    async arrange(api) {
      await startPlaying(api);
      // The run-up puts half a second of level approach in front of the contact, so
      // the clip shows the ball MEET the paddle center rather than opening on a
      // return already under way — the outgoing line means nothing to a reviewer who
      // never saw where it came off. The paddle is still, so it simply waits there.
      await arrangeLeftPaddleHit(api, {
        cy: 360,
        vy: 0,
        ballY: 360,
        leadTicks: LEAD_TICKS,
      });
    },

    // Run the real bounce and read the ball the instant it rebounds, before spin can
    // decay or curve the flight. This IS the clip: the reviewer watches the approach
    // and then the return, which the tail holds on long enough to read as straight.
    async act(api) {
      center = await actLeftPaddleHit(api, { leadTicks: LEAD_TICKS });
      await api.advance(120); // 120 ticks (1s) of return flight, so the clip shows the line
    },

    async assert(api, check) {
      const centerAngle = angleDeg(center.ball);
      check.expectOk("the center hit contacts the paddle", center.hit);
      check.expectGt(
        "a center hit sends the ball back across (vx)",
        center.ball.vx,
        0,
      );
      check.expectLt(
        "a center hit returns straight across (deg)",
        centerAngle,
        3,
      );
    },
  };
}
