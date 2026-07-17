// Automated validation for the `paddle-angle` review item (sub-items: center,
// edge).
//
// The outgoing angle comes from the contact point on a stationary paddle
// (physics.md: `offset = (ballY - paddleCy) / 55`, `theta = offset * 55deg`). A
// center hit (ball level with the paddle center) leaves the field straight; an
// extreme-edge hit (ball one half-height off center) leaves at ~55deg. The paddle
// pose and contact height are preconditions; the real bounce produces the
// outgoing velocity we read back.

import { hitLeftPaddle, startPlaying, PADDLE_HALF } from "./_helpers.mjs";

function angleDeg(ball) {
  return (Math.atan2(Math.abs(ball.vy), Math.abs(ball.vx)) * 180) / Math.PI;
}

export default async function drive(api) {
  // Center: ball level with the paddle center -> straight across (vy ~ 0).
  await startPlaying(api);
  const center = await hitLeftPaddle(api, { cy: 360, vy: 0, ballY: 360 });
  const centerAngle = angleDeg(center.ball);
  const centerPass = center.hit && center.ball.vx > 0 && centerAngle < 3;

  // Edge: ball one half-height below center -> steep (~55deg) downward.
  await startPlaying(api);
  const edge = await hitLeftPaddle(api, {
    cy: 360,
    vy: 0,
    ballY: 360 + PADDLE_HALF,
  });
  const edgeAngle = angleDeg(edge.ball);
  const edgePass = edge.hit && edge.ball.vx > 0 && Math.abs(edgeAngle - 55) < 8;

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

  // Verdict ids are the item's composite sub-item ids (<item>.<sub-item>).
  return {
    verdicts: {
      "paddle-angle.center": centerPass,
      "paddle-angle.edge": edgePass,
    },
    notes: {
      "paddle-angle.center": `center hit outgoing angle=${centerAngle.toFixed(1)}deg (vy=${center.ball.vy.toFixed(1)})`,
      "paddle-angle.edge": `edge hit outgoing angle=${edgeAngle.toFixed(1)}deg (expected ~55)`,
    },
  };
}
