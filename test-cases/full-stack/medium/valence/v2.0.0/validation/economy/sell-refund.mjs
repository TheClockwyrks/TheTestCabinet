// Automated validation for the Economy sub-item `sell-refund`.
//
// Selling a tower after a round has begun refunds a fraction (about 70%) of what was
// spent on it. The check starts a live round, places an Emitter (so it is no longer
// refundable in full), sells it, and confirms the refund is the floored 70% of its spend.

import { startRun, pathGeom, placeCovering, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.sell-refund");

  await startRun(api, MAP.single, { energy: 100000, round: 1 });
  await api.call("startRound");
  const snap = await api.snapshot();
  const g = pathGeom(snap.paths[0]);
  const t = await placeCovering(api, "emitter", g, g.length * 0.3);
  const spent = (await api.snapshot()).towers.find((x) => x.id === t.id).spent;

  const refund = await api.call("sellTower", t.id);
  check.expectEq("a mid-round sell refunds the floored 70% of the spend", refund, Math.floor(spent * 0.7));

  await api.wait(150);
  await api.screenshot("sell");
  return check.verdict();
}
