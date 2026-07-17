// Automated validation for the `ball-spin` sub-item `stationary`: a paddle that is
// not moving imparts no new spin, so the ball's flight stays straight after contact.
//
// Drives a real stationary-paddle contact through window.__carom and reads back the
// spin the simulation imparts (physics.md: `spin += paddleVy * 0.85` on a hit — zero
// when the paddle is not moving). The paddle pose is a precondition; the bounce and
// the spin it does or does not add are produced by the real physics.

import { hitLeftPaddle, startPlaying } from "../_helpers.mjs";

export default async function drive(api) {
  await startPlaying(api);

  // Stationary paddle, ball with no spin: the real bounce must impart none.
  const still = await hitLeftPaddle(api, { cy: 360, vy: 0, ballY: 360 });
  const pass = still.hit && Math.abs(still.ball.spin) < 0.5;

  // A clip: a stationary-paddle return travelling straight across, no curve.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, { x: 300, y: 360, vx: -460, vy: 0, spin: 0 });
  await api.wait(1600);

  // The verdict id is the composite sub-item id, the form the reviewer's checklist
  // and scoring look it up under.
  return {
    verdicts: { "ball-spin.stationary": pass },
    notes: {
      "ball-spin.stationary": `stationary-paddle hit imparted spin=${still.ball.spin.toFixed(2)} (|spin|<0.5)`,
    },
  };
}
