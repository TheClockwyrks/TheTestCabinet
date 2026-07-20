// Automated validation for the Star-core item `bullet-absorbed`: a bullet that reaches
// the core is absorbed and removed (not passed through, no score). A real bullet is
// placed just above the core heading into it; well within its lifetime the real
// collision code must remove it, and the score must not change.

import { newGame, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("star-core.bullet-absorbed");

  await newGame(api);
  await api.call("setScore", 0);
  await api.call("addBullet", { x: 640, y: 300, vx: 0, vy: 120 });

  // Step less than a bullet's lifetime: if it is gone, it was absorbed, not expired.
  await api.step(0.5);
  const snap = await api.snapshot();

  check.expectEq("the bullet is absorbed and removed at the core", snap.bullets.length, 0);
  check.expectEq("absorbing a bullet scores nothing", snap.score, 0);

  await newGame(api);
  await api.call("addBullet", { x: 640, y: 300, vx: 0, vy: 120 });
  await liveClip(api, 700);
  return check.verdict();
}
