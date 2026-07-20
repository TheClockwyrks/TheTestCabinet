// Automated validation for the Screen-wrap item `ship`: the ship crossing an edge
// reappears at the opposite edge carrying the same velocity. The ship is posed at the
// right edge moving right; the real sim is stepped one frame at a time until it wraps,
// and its state just before and just after the wrap is compared.

import { newGame, poseShip, wrapAcross, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("wrap.ship");

  await newGame(api);
  await poseShip(api, { x: 1275, y: 360, vx: 300, vy: 0, angle: 0 });
  const { before, after, wrapped } = await wrapAcross(api, (s) => s.ship);

  check.expectOk("the ship crossed the right edge and re-entered on the left", wrapped);
  check.expectGt("it was near the right edge before wrapping", before.x, 1200);
  check.expectLt("it reappeared at the left edge", after.x, 60);
  check.expectClose("it carries the same horizontal velocity across the wrap", after.vx, before.vx, 3);
  check.expectClose("its vertical velocity is unchanged", after.vy, before.vy, 3);

  await liveClip(api, 800);
  return check.verdict();
}
