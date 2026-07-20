// Automated validation for the Bullets item `max-four`: at most four of the ship's
// bullets exist at once. The ship is posed firing away from the star, and Space is
// tapped five times (with enough spacing to clear the fire-rate limit each time); the
// on-screen bullet count is tracked and must peak at four, never five.

import { newGame, poseShip, MAX_BULLETS, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bullets.max-four");

  await newGame(api);
  await poseShip(api, { x: 200, y: 200, vx: 0, vy: 0, angle: (-135 * Math.PI) / 180 });

  let maxSeen = 0;
  for (let i = 0; i < 5; i += 1) {
    await api.call("press", "Space");
    await api.step(0.2); // clears the ~0.18 s fire interval so each tap can fire
    maxSeen = Math.max(maxSeen, (await api.snapshot()).bullets.length);
  }
  const final = (await api.snapshot()).bullets.length;

  check.expectEq("five shots never put more than four bullets on screen", maxSeen, MAX_BULLETS);
  check.expectLe("the on-screen bullet count is capped at four", final, MAX_BULLETS);

  await liveClip(api, 700);
  return check.verdict();
}
