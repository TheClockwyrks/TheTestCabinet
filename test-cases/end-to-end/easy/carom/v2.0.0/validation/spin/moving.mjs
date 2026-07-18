// Automated validation for the Spin sub-item `moving`: a paddle swung as it strikes
// the ball imparts significant spin, and up vs. down curve the ball opposite ways
// (opposite spin signs).
//
// Drives real moving-paddle contacts through window.__carom and reads back the spin
// the simulation imparts (physics.md: `spin += paddleVy * 0.85` on a hit). The
// paddle's pose and motion are preconditions; the bounce — and the spin it adds — is
// produced by the real physics.

import { hitLeftPaddle, startPlaying } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("spin.moving");

  // Moving paddle, downward (vy > 0): must impart significant positive spin.
  await startPlaying(api);
  const down = await hitLeftPaddle(api, { cy: 340, vy: 720, ballY: 360 });

  // Moving paddle, upward (vy < 0): significant spin of the OPPOSITE sign.
  await startPlaying(api);
  const up = await hitLeftPaddle(api, { cy: 380, vy: -720, ballY: 360 });

  check.expectOk("a downward swing contacts the paddle", down.hit);
  check.expectGt(
    "a downward swing imparts significant positive spin (spin)",
    down.ball.spin,
    400,
  );
  check.expectOk("an upward swing contacts the paddle", up.hit);
  check.expectLt(
    "an upward swing imparts significant negative spin (spin)",
    up.ball.spin,
    -400,
  );
  check.expectOk(
    "up and down swings curve the ball opposite ways (opposite spin signs)",
    Math.sign(down.ball.spin) === -Math.sign(up.ball.spin),
  );

  // A clip: a strong curving shot, so the reviewer sees the flight bend.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 150, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, { x: 220, y: 360, vx: 520, vy: 0, spin: 720 });
  await api.wait(1600);

  return check.verdict();
}
