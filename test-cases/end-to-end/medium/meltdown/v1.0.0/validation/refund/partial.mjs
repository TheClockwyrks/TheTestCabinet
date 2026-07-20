// Automated validation for the Refund sub-item `partial`.
//
// Selling a tower that has fought a wave refunds 70% of everything spent on it
// (specs/towers.md). We place an Arc (cost 15) off in the corner, run wave 1 to a
// clear so the tower has fought, then sell it from zero money — 70% of 15 is 10.

import { newGame, build, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("refund.partial");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 1000000);
  const id = await build(api, "arc", 40, 30); // far from any lane, so it never fires
  await api.call("startWave");
  const cleared = await stepUntil(api, (s) => s.wave >= 2, 40, 0.2);
  check.expectOk("wave 1 was fought and cleared", cleared.hit);

  await api.call("setMoney", 0);
  await api.call("sellTower", id);
  check.expectEq("a fought tower refunds 70% of its 15 cost (10)", (await api.snapshot()).money, 10);

  await liveClip(api, 1400);
  return check.verdict();
}
