// Automated validation for the Paddles sub-item `hit-edge`.
//
// Hitting the extreme top/bottom EDGE of a stationary paddle sends the ball off at a
// steep (~55deg) angle. The outgoing angle comes from the contact point on a
// stationary paddle (physics.md: `offset = (ballY - paddleCy) / 55`,
// `theta = offset * 55deg`), so a contact one paddle-half-height off center returns at
// ~55deg. The paddle pose and contact height are preconditions; the real bounce
// produces the outgoing velocity we read back. The straight center case is the
// sibling `hit-center` check.

import {
  arrangeLeftPaddleHit,
  actLeftPaddleHit,
  startPlaying,
  PADDLE_HALF,
} from "../_helpers.mjs";

function angleDeg(ball) {
  return (Math.atan2(Math.abs(ball.vy), Math.abs(ball.vx)) * 180) / Math.PI;
}

export default function item() {
  let edge;

  return {
    id: "paddles.hit-edge",

    // Edge: ball one half-height below center -> steep (~55deg) downward. The paddle
    // is stationary (vy 0) so the steep angle is the contact point's doing alone, not
    // spin imparted by a moving paddle.
    async arrange(api) {
      await startPlaying(api);
      await arrangeLeftPaddleHit(api, {
        cy: 360,
        vy: 0,
        ballY: 360 + PADDLE_HALF,
      });
    },

    // Run the real bounce and read the ball the instant it rebounds, before spin can
    // decay or curve the flight. This IS the clip: the reviewer watches the approach
    // and then the sharp deflection, which the tail holds on long enough to read.
    async act(api) {
      edge = await actLeftPaddleHit(api);
      await api.advance(120); // 120 ticks (1s) of flight, so the clip shows the angle
    },

    async assert(api, check) {
      const edgeAngle = angleDeg(edge.ball);
      check.expectOk("the edge hit contacts the paddle", edge.hit);
      check.expectGt(
        "an edge hit sends the ball back across (vx)",
        edge.ball.vx,
        0,
      );
      check.expectClose(
        "an extreme-edge hit deflects steeply (~55deg)",
        edgeAngle,
        55,
        8,
      );
    },
  };
}
