// Automated validation for the Upgrades sub-item `cost`.
//
// Upgrading to level II costs the build cost; to level III costs 1.8x the build cost
// (specs/towers.md). An Arc costs 15, so II costs 15 and III costs 27. We set a known
// balance and read the money spent on each real upgrade.

import { newGame, build } from "../_helpers.mjs";

const money = async (api) => (await api.snapshot()).money;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("upgrades.cost");

  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  await api.call("setMoney", 1000);

  const m0 = await money(api);
  await api.call("upgradeTower", arc);
  const m1 = await money(api);
  await api.call("upgradeTower", arc);
  const m2 = await money(api);

  check.expectEq("upgrade to II costs the build cost (15)", m0 - m1, 15);
  check.expectEq("upgrade to III costs 1.8x the build cost (27)", m1 - m2, 27);

  await api.wait(80);
  await api.screenshot("cost");
  return check.verdict();
}
