// Automated validation for the Gravity item `bullet-curves`: a bullet fired past the
// star is pulled toward it and visibly curves. A real bullet is placed above and to the
// left of the star moving purely horizontally (no vertical velocity), so it flies across
// the top of the well; after the real sim steps, gravity must have given it a clear
// velocity toward the star (downward), bending its path.

import { newGame, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gravity.bullet-curves");

  await newGame(api);
  await api.call("addBullet", { x: 440, y: 300, vx: 520, vy: 0 });
  const before = (await api.snapshot()).bullets[0];
  check.expectClose("the bullet starts with no vertical velocity", before.vy, 0, 1e-6);

  await api.step(0.35); // fly it across the top of the well
  const after = (await api.snapshot()).bullets[0];
  check.expectOk("the bullet is still in flight past the star", Boolean(after));
  check.expectGt("gravity bent the shot toward the star (gained downward velocity)", after.vy, 30);

  await newGame(api);
  await api.call("addBullet", { x: 440, y: 300, vx: 520, vy: 0 });
  await liveClip(api, 900);
  return check.verdict();
}
