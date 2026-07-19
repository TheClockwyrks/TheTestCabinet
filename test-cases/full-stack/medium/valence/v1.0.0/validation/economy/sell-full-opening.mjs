// Automated validation for the Economy sub-item `sell-full-opening`.
//
// A tower placed and sold during the untimed opening build phase (before round one)
// refunds its full cost. The check places an Emitter in the opening phase and sells it,
// confirming the refund equals the full spend.

import { startRun, pathGeom, placeCovering, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.sell-full-opening");

  const snap = await startRun(api, MAP.single, { energy: 100000 });
  check.expectEq("the opening phase is the build phase", snap.phase, "build");
  const g = pathGeom(snap.paths[0]);
  const t = await placeCovering(api, "emitter", g, g.length * 0.3);
  const spent = (await api.snapshot()).towers.find((x) => x.id === t.id).spent;

  const refund = await api.call("sellTower", t.id);
  check.expectEq("a sell in the opening phase refunds in full", refund, spent);

  await api.wait(150);
  await api.screenshot("sell");
  return check.verdict();
}
