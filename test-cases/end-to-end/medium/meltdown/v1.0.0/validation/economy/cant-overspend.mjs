// Automated validation for the Economy sub-item `cant-overspend`.
//
// A tower the player cannot afford cannot be placed, and money never goes negative
// (specs/economy.md). With only 5 money (below the Arc's cost of 15), the placement
// check refuses it and money is unchanged.

import { newGame } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.cant-overspend");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setMoney", 5);
  const can = await api.call("canPlace", "arc", 10, 10, 0);
  await api.call("placeTower", "arc", 10, 10, 0);
  const s = await api.snapshot();

  check.expectEq("an unaffordable tower cannot be placed", can, false);
  check.expectEq("nothing is built", s.towers.length, 0);
  check.expectEq("money is unchanged (never negative)", s.money, 5);

  await api.wait(80);
  await api.screenshot("afford");
  return check.verdict();
}
