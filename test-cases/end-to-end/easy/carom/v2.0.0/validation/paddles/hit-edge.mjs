// Automated validation for the Paddles sub-item `hit-edge`.
//
// Hitting the extreme top/bottom EDGE of a stationary paddle sends the ball off at a
// steep (~55deg) angle. The outgoing angle comes from the contact point on a
// stationary paddle (physics.md: `offset = (ballY - paddleCy) / 55`,
// `theta = offset * 55deg`), so a contact one paddle-half-height off center returns at
// ~55deg. The paddle pose and contact height are preconditions; the real bounce
// produces the outgoing velocity we read back. The straight center case is the
// sibling `hit-center` check.

import { hitLeftPaddle, startPlaying, PADDLE_HALF } from "../_helpers.mjs";

function angleDeg(ball) {
  return (Math.atan2(Math.abs(ball.vy), Math.abs(ball.vx)) * 180) / Math.PI;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("paddles.hit-edge");

  // Edge: ball one half-height below center -> steep (~55deg) downward.
  await startPlaying(api);
  const edge = await hitLeftPaddle(api, {
    cy: 360,
    vy: 0,
    ballY: 360 + PADDLE_HALF,
  });
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

  // A clip: a steep edge deflection carrying the ball off at a sharp angle.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, {
    x: 90,
    y: 360 + PADDLE_HALF,
    vx: -420,
    vy: 0,
    spin: 0,
  });
  await api.wait(1400);

  return check.verdict();
}
