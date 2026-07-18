// Automated validation for the Paddles sub-item `paddle-angle`.
//
// Hitting the CENTER of a stationary paddle sends the ball straight across; hitting
// the extreme top/bottom EDGE sends it off at a steep (~55deg) angle. The outgoing
// angle comes from the contact point on a stationary paddle (physics.md:
// `offset = (ballY - paddleCy) / 55`, `theta = offset * 55deg`). The paddle pose
// and contact height are preconditions; the real bounce produces the outgoing
// velocity we read back. Both the center and the edge case must hold.

import {
  asserter,
  hitLeftPaddle,
  startPlaying,
  PADDLE_HALF,
} from "../_helpers.mjs";

function angleDeg(ball) {
  return (Math.atan2(Math.abs(ball.vy), Math.abs(ball.vx)) * 180) / Math.PI;
}

export default async function drive(api) {
  const rec = asserter();

  // Center: ball level with the paddle center -> straight across (vy ~ 0).
  await startPlaying(api);
  const center = await hitLeftPaddle(api, { cy: 360, vy: 0, ballY: 360 });
  const centerAngle = angleDeg(center.ball);
  rec.check(
    `a center hit returns straight across (${centerAngle.toFixed(1)}deg < 3)`,
    center.hit && center.ball.vx > 0 && centerAngle < 3,
  );

  // Edge: ball one half-height below center -> steep (~55deg) downward.
  await startPlaying(api);
  const edge = await hitLeftPaddle(api, {
    cy: 360,
    vy: 0,
    ballY: 360 + PADDLE_HALF,
  });
  const edgeAngle = angleDeg(edge.ball);
  rec.check(
    `an extreme-edge hit deflects steeply (${edgeAngle.toFixed(1)}deg ~ 55)`,
    edge.hit && edge.ball.vx > 0 && Math.abs(edgeAngle - 55) < 8,
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

  return { verdicts: { "paddles.paddle-angle": rec.assertions } };
}
