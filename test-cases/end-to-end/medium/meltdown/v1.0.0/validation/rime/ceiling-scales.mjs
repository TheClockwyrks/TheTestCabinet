// Automated validation for the Rime sub-item `ceiling-scales`.
//
// Upgrading a Rime raises its cold-slow ceiling (0.55/0.68/0.80; specs/heat.md,
// towers.md) rather than its damage. We read the Rime's cold (heat 0) slow fraction
// across its three levels (upgraded through the real upgrade code); it rises.

import { newGame, build, tower } from "../_helpers.mjs";

export default function item() {
  let rimeId;
  let l1;
  let l2;
  let l3;

  return {
    id: "rime.ceiling-scales",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      rimeId = await build(api, "rime", 12, 12);
    },

    // Read the ceiling at each level, re-posing heat 0 after every upgrade so the
    // three readings differ only by level and not by any heat the upgrade left behind.
    async act(api) {
      await api.call("setHeat", rimeId, 0);
      l1 = (await tower(api, rimeId)).slowFactor;
      await api.call("upgradeTower", rimeId);
      await api.call("setHeat", rimeId, 0);
      l2 = (await tower(api, rimeId)).slowFactor;
      await api.call("upgradeTower", rimeId);
      await api.call("setHeat", rimeId, 0);
      l3 = (await tower(api, rimeId)).slowFactor;

      await api.settle(80);
      await api.screenshot("ceiling");
    },

    async assert(api, check) {
      check.expectClose("level-I cold-slow ceiling", l1, 0.55, 0.02);
      check.expectClose("level-II cold-slow ceiling", l2, 0.68, 0.02);
      check.expectClose("level-III cold-slow ceiling", l3, 0.8, 0.02);
      check.expectGt("upgrading raises the ceiling (II > I)", l2, l1);
      check.expectGt("upgrading raises the ceiling (III > II)", l3, l2);
    },
  };
}
