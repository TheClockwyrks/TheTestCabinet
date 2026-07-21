// Automated validation for the Upgrades sub-item `cost`.
//
// Upgrading to level II costs the build cost; to level III costs 1.8x the build cost
// (specs/towers.md). An Arc costs 15, so II costs 15 and III costs 27. We set a known
// balance and read the money spent on each real upgrade.

import { newGame, build } from "../_helpers.mjs";

const money = async (api) => (await api.snapshot()).money;

export default function item() {
  let arcId;
  let m0;
  let m1;
  let m2;

  return {
    id: "upgrades.cost",

    // A placed Arc and a known balance, so each upgrade's cost is read as an exact
    // difference rather than against whatever the mode happened to start with.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      arcId = await build(api, "arc", 12, 12);
      await api.call("setMoney", 1000);
    },

    // Both upgrades go through the real upgrade code, reading the balance either side
    // of each.
    async act(api) {
      m0 = await money(api);
      await api.call("upgradeTower", arcId);
      m1 = await money(api);
      await api.call("upgradeTower", arcId);
      m2 = await money(api);

      await api.settle(80);
      await api.screenshot("cost");
    },

    async assert(api, check) {
      check.expectEq("upgrade to II costs the build cost (15)", m0 - m1, 15);
      check.expectEq(
        "upgrade to III costs 1.8x the build cost (27)",
        m1 - m2,
        27,
      );
    },
  };
}
