// Automated validation for the Screen-wrap item `rock`: a rock crossing an edge
// reappears at the opposite edge carrying the same velocity. A real rock is placed at
// the right edge (far from the star, so gravity is negligible over the wrap) moving
// right; the sim is stepped until it wraps and its state before/after is compared.

import { newGame, wrapAcross, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("wrap.rock");

  await newGame(api);
  await api.call("addRock", "medium", { x: 1272, y: 80, vx: 300, vy: 0 });
  const { before, after, wrapped } = await wrapAcross(api, (s) => s.rocks[0]);

  check.expectOk("the rock crossed the right edge and re-entered on the left", wrapped);
  check.expectGt("it was near the right edge before wrapping", before.x, 1200);
  check.expectLt("it reappeared at the left edge", after.x, 60);
  check.expectClose("it carries the same horizontal velocity across the wrap", after.vx, before.vx, 4);
  check.expectClose("its vertical velocity is unchanged across the wrap", after.vy, before.vy, 4);

  await liveClip(api, 800);
  return check.verdict();
}
