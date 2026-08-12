// Automated validation for the Upgrades sub-item `cost`.
//
// Upgrading to level II costs the build cost; to level III costs 1.8x the build cost
// (specs/towers.md). An Arc costs 15, so II costs 15 and III costs 27. We set a known
// balance and read the money spent on each real upgrade.
//
// ONE STILL PER STEP, WITH THE TOWER SELECTED.
//
// This used to take a single screenshot after both upgrades had landed, which showed a
// level-III Arc and a balance of 958 — two numbers that mean nothing on their own, since
// what the item claims is the DIFFERENCE either side of each upgrade and neither
// difference was in the frame. Worse, nothing in the frame was even the subject: the
// upgrade cost is an inspector read ("Upgrade (with its cost) and Sell (with its refund)
// actions", specs/controls.md) and no tower was selected, so the panel showed the
// between-wave hint instead.
//
// So the Arc is selected, and a still is captured at each step: after the 15 that buys
// level II, and after the 27 that buys level III. Each frame carries the level it just
// reached, the balance that paid for it, and the cost of the NEXT one — so the two
// stills together show both costs in the place the game states them.

import { newGame, build } from "../_helpers.mjs";

const money = async (api) => (await api.snapshot()).money;

export default function item() {
  let arcId;
  let m0;
  let m1;
  let m2;

  return {
    id: "upgrades.cost",

    // A placed, SELECTED Arc and a known balance, so each upgrade's cost is read as an
    // exact difference rather than against whatever the mode happened to start with —
    // and so the inspector that states those costs is the panel on screen.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      arcId = await build(api, "arc", 12, 12);
      await api.call("selectTower", arcId);
      await api.call("setMoney", 1000);
    },

    // Both upgrades go through the real upgrade code, reading the balance either side
    // of each and capturing the inspector as it lands.
    async act(api) {
      m0 = await money(api);

      await api.call("upgradeTower", arcId);
      m1 = await money(api);
      await api.settle(120);
      await api.screenshot("level-2");

      await api.call("upgradeTower", arcId);
      m2 = await money(api);
      await api.settle(120);
      await api.screenshot("level-3");
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
