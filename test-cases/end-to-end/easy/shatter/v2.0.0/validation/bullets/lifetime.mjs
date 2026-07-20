// Automated validation for the Bullets item `lifetime`: a bullet expires after a limited
// lifetime (~1.5 s). A real bullet is placed at rest far from the star (so gravity does
// not sweep it into the core) and the real sim is stepped: it is still alive just before
// 1.5 s and gone just after.

import { newGame, BULLET_LIFE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bullets.lifetime");

  await newGame(api);
  await api.call("addBullet", { x: 200, y: 200, vx: 0, vy: 0 });

  await api.step(1.4);
  const nearEnd = await api.snapshot();
  check.expectEq("the bullet is still alive shortly before its lifetime ends", nearEnd.bullets.length, 1);
  if (nearEnd.bullets[0]) {
    check.expectClose("its remaining life reads ~0.1 s at t=1.4 s", nearEnd.bullets[0].life, BULLET_LIFE - 1.4, 0.03);
  }

  await api.step(0.2); // past the 1.5 s lifetime
  check.expectEq("the bullet is gone once its lifetime elapses", (await api.snapshot()).bullets.length, 0);

  await newGame(api);
  await api.call("addBullet", { x: 200, y: 200, vx: 120, vy: 0 });
  await liveClip(api, 700);
  return check.verdict();
}
