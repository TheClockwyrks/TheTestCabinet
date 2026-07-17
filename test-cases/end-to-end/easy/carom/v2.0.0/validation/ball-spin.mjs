// Automated validation for the `ball-spin` review item (sub-items: stationary,
// moving).
//
// Drives real paddle contacts through window.__carom and reads back the spin the
// simulation imparts. The paddle's pose and motion are preconditions; the bounce
// itself — and the spin it does or does not add — is produced by the real physics
// (physics.md: `spin += paddleVy * 0.85` on a hit). A stationary paddle must add
// no spin; a moving paddle must add significant spin, and up vs. down must curve
// the ball opposite ways (opposite spin signs).

import { hitLeftPaddle, startPlaying } from "./_helpers.mjs";

export default async function drive(api) {
  await startPlaying(api);

  // Stationary paddle, ball with no spin: the real bounce must impart none.
  const still = await hitLeftPaddle(api, { cy: 360, vy: 0, ballY: 360 });
  const stationaryPass = still.hit && Math.abs(still.ball.spin) < 0.5;

  // Moving paddle, downward (vy > 0): must impart significant positive spin.
  await startPlaying(api);
  const down = await hitLeftPaddle(api, { cy: 340, vy: 720, ballY: 360 });

  // Moving paddle, upward (vy < 0): significant spin of the OPPOSITE sign.
  await startPlaying(api);
  const up = await hitLeftPaddle(api, { cy: 380, vy: -720, ballY: 360 });

  const movingPass =
    down.hit &&
    up.hit &&
    down.ball.spin > 400 &&
    up.ball.spin < -400 &&
    Math.sign(down.ball.spin) === -Math.sign(up.ball.spin);

  // A clip: a strong curving shot, so the reviewer sees the flight bend.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 150, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, { x: 220, y: 360, vx: 520, vy: 0, spin: 720 });
  await api.wait(1600);

  // Verdict ids are the item's composite sub-item ids (<item>.<sub-item>), the
  // form the reviewer's checklist and scoring look them up under.
  return {
    verdicts: {
      "ball-spin.stationary": stationaryPass,
      "ball-spin.moving": movingPass,
    },
    notes: {
      "ball-spin.stationary": `stationary-paddle hit imparted spin=${still.ball.spin.toFixed(2)}`,
      "ball-spin.moving": `down-paddle spin=${down.ball.spin.toFixed(1)}, up-paddle spin=${up.ball.spin.toFixed(1)} (opposite signs, |·|>400)`,
    },
  };
}
