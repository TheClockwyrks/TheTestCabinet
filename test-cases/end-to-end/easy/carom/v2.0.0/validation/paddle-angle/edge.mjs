// Automated validation for the `paddle-angle` sub-item `edge`: hitting the extreme
// top or bottom edge of a stationary paddle sends the ball off at a steep (~55deg)
// angle.
//
// The outgoing angle comes from the contact point on a stationary paddle
// (physics.md: `offset = (ballY - paddleCy) / 55`, `theta = offset * 55deg`). An
// extreme-edge hit (ball one half-height off center) leaves at ~55deg. The paddle
// pose and contact height are preconditions; the real bounce produces the outgoing
// velocity we read back.

import { hitLeftPaddle, startPlaying, PADDLE_HALF } from "../_helpers.mjs";

function angleDeg(ball) {
  return (Math.atan2(Math.abs(ball.vy), Math.abs(ball.vx)) * 180) / Math.PI;
}

export default async function drive(api) {
  // Edge: ball one half-height below center -> steep (~55deg) downward.
  await startPlaying(api);
  const edge = await hitLeftPaddle(api, {
    cy: 360,
    vy: 0,
    ballY: 360 + PADDLE_HALF,
  });
  const angle = angleDeg(edge.ball);
  const pass = edge.hit && edge.ball.vx > 0 && Math.abs(angle - 55) < 8;

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

  // The verdict id is the composite sub-item id, the form the reviewer's checklist
  // and scoring look it up under.
  return {
    verdicts: { "paddle-angle.edge": pass },
    notes: {
      "paddle-angle.edge": `edge hit outgoing angle=${angle.toFixed(1)}deg (expected ~55)`,
    },
  };
}
