// Automated validation for the Refund sub-item `full-before-wave`.
//
// A tower sold before the wave it was placed on has started refunds its full spend
// (specs/towers.md), so the untimed opening build can be re-shaped without penalty.
// We set a known balance, place an Arc, and sell it in the same opening phase — the
// money returns to exactly where it started.

import { newGame, build } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("refund.full-before-wave");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setMoney", 1000);
  const id = await build(api, "arc", 10, 10);
  const afterBuild = (await api.snapshot()).money;
  await api.call("sellTower", id);
  const afterSell = (await api.snapshot()).money;

  check.expectEq("building the Arc costs 15", afterBuild, 985);
  check.expectEq("selling before the wave refunds the full spend", afterSell, 1000);

  await api.wait(80);
  await api.call("setAutoStep", true);
  await api.wait(1400);
  return check.verdict();
}
