// Automated validation for the Screen-wrap item `saucer`: the saucer crossing an edge
// reappears at the opposite edge carrying the same velocity. A saucer is posed at the
// right edge (clear of the star, so its avoidance never fires) moving right; the sim is
// stepped until it wraps and its state before/after is compared.

import { newGame, wrapAcross, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("wrap.saucer");

  await newGame(api);
  await api.call("spawnSaucer");
  await api.call("setSaucer", { x: 1275, y: 80, vx: 300, vy: 0 });
  const { before, after, wrapped } = await wrapAcross(api, (s) => s.saucer);

  check.expectOk("the saucer crossed the right edge and re-entered on the left", wrapped);
  check.expectGt("it was near the right edge before wrapping", before.x, 1200);
  check.expectLt("it reappeared at the left edge", after.x, 60);
  check.expectClose("it carries the same horizontal velocity across the wrap", after.vx, before.vx, 2);
  check.expectClose("its vertical velocity is unchanged across the wrap", after.vy, before.vy, 2);

  await liveClip(api, 800);
  return check.verdict();
}
