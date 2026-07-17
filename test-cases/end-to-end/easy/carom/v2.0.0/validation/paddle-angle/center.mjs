// Automated validation for the `paddle-angle` sub-item `center`: hitting the center
// of a stationary paddle sends the ball straight across the field.
//
// The outgoing angle comes from the contact point on a stationary paddle
// (physics.md: `offset = (ballY - paddleCy) / 55`, `theta = offset * 55deg`). A
// center hit (ball level with the paddle center) leaves the field straight. The
// paddle pose and contact height are preconditions; the real bounce produces the
// outgoing velocity we read back.

import { hitLeftPaddle, startPlaying } from "../_helpers.mjs";

function angleDeg(ball) {
  return (Math.atan2(Math.abs(ball.vy), Math.abs(ball.vx)) * 180) / Math.PI;
}

export default async function drive(api) {
  // Center: ball level with the paddle center -> straight across (vy ~ 0).
  await startPlaying(api);
  const center = await hitLeftPaddle(api, { cy: 360, vy: 0, ballY: 360 });
  const angle = angleDeg(center.ball);
  const pass = center.hit && center.ball.vx > 0 && angle < 3;

  // A clip: a center hit carrying the ball straight across the field.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, { x: 300, y: 360, vx: -420, vy: 0, spin: 0 });
  await api.wait(1400);

  // The verdict id is the composite sub-item id, the form the reviewer's checklist
  // and scoring look it up under.
  return {
    verdicts: { "paddle-angle.center": pass },
    notes: {
      "paddle-angle.center": `center hit outgoing angle=${angle.toFixed(1)}deg (vy=${center.ball.vy.toFixed(1)})`,
    },
  };
}
