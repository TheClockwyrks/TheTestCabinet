// Automated validation for the Paddles sub-item `hit-center`.
//
// Hitting the CENTER of a stationary paddle sends the ball straight across, with no
// vertical angle. The outgoing angle comes from the contact point on a stationary
// paddle (physics.md: `offset = (ballY - paddleCy) / 55`, `theta = offset * 55deg`),
// so a contact level with the paddle center returns straight. The paddle pose and
// contact height are preconditions; the real bounce produces the outgoing velocity we
// read back. The steep edge case is the sibling `hit-edge` check.

import { asserter, hitLeftPaddle, startPlaying } from "../_helpers.mjs";

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

  // A clip: a center hit carrying the ball straight back across the field.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, { x: 90, y: 360, vx: -420, vy: 0, spin: 0 });
  await api.wait(1400);

  return { verdicts: { "paddles.hit-center": rec.assertions } };
}
