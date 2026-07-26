// Automated validation for the Economy sub-item `cant-overspend`.
//
// A tower the player cannot afford cannot be placed, and money never goes negative
// (specs/economy.md). With only 5 money (below the Arc's cost of 15), the placement
// check refuses it and money is unchanged.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let can;
  let s;

  return {
    id: "economy.cant-overspend",

    // A balance deliberately below the Arc's 15 cost.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setMoney", 5);
    },

    // Ask the validator AND drive the real placement path — a build could refuse in
    // one and not the other, so both are exercised.
    async act(api) {
      can = await api.call("canPlace", "arc", 10, 10, 0);
      await api.call("placeTower", "arc", 10, 10, 0);
      s = await api.snapshot();
      await api.settle(80);
      await api.screenshot("afford");
    },

    async assert(api, check) {
      check.expectEq("an unaffordable tower cannot be placed", can, false);
      check.expectEq("nothing is built", s.towers.length, 0);
      check.expectEq("money is unchanged (never negative)", s.money, 5);
    },
  };
}
