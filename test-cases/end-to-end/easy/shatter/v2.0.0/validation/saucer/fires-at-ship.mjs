// Automated validation for the Saucer item `fires-at-ship`: the saucer fires bullets
// aimed at the ship. A saucer is posed on the left, well clear of the star, with the ship
// far to its right; as the real sim runs past the saucer's fire interval it must emit an
// enemy bullet travelling toward the ship (rightward).

import { newGame, poseShip, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("saucer.fires-at-ship");

  await newGame(api);
  // Pose the ship to the saucer's right, within half a field so the shortest
  // wrapped path from the saucer to the ship runs rightward (no wrap seam between
  // them). Re-pin the saucer each step so it holds its spot instead of drifting.
  await poseShip(api, { x: 700, y: 360, vx: 0, vy: 0, angle: 0 });
  await api.call("spawnSaucer");

  const r = await (async () => {
    for (let i = 0; i < 120; i += 1) {
      await api.call("setSaucer", { x: 220, y: 360, vx: 0, vy: 0 });
      await api.step(0.02);
      const eb = (await api.snapshot()).enemyBullets;
      if (eb.length > 0) return eb[0];
    }
    return null;
  })();

  check.expectOk("the saucer fires an enemy bullet", Boolean(r));
  if (r) {
    check.expectGt("the shot is aimed at the ship (travelling toward it, to the right)", r.vx, 80);
  }

  await api.call("setSaucer", { x: 220, y: 360, vx: 0, vy: 0 });
  await liveClip(api, 1000);
  return check.verdict();
}
