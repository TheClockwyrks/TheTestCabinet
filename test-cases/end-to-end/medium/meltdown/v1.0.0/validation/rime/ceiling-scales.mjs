// Automated validation for the Rime sub-item `ceiling-scales`.
//
// Upgrading a Rime raises its cold-slow ceiling (0.55/0.68/0.80; specs/heat.md,
// towers.md) rather than its damage. We read the Rime's cold (heat 0) slow fraction
// across its three levels (upgraded through the real upgrade code); it rises.

import { newGame, build, tower } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rime.ceiling-scales");

  await newGame(api, "containment", "medium", 100000);
  const rime = await build(api, "rime", 12, 12);

  await api.call("setHeat", rime, 0);
  const l1 = (await tower(api, rime)).slowFactor;
  await api.call("upgradeTower", rime);
  await api.call("setHeat", rime, 0);
  const l2 = (await tower(api, rime)).slowFactor;
  await api.call("upgradeTower", rime);
  await api.call("setHeat", rime, 0);
  const l3 = (await tower(api, rime)).slowFactor;

  check.expectClose("level-I cold-slow ceiling", l1, 0.55, 0.02);
  check.expectClose("level-II cold-slow ceiling", l2, 0.68, 0.02);
  check.expectClose("level-III cold-slow ceiling", l3, 0.8, 0.02);
  check.expectGt("upgrading raises the ceiling (II > I)", l2, l1);
  check.expectGt("upgrading raises the ceiling (III > II)", l3, l2);

  await api.wait(80);
  await api.screenshot("ceiling");
  return check.verdict();
}
