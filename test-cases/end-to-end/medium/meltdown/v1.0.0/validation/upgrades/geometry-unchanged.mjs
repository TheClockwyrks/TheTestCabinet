// Automated validation for the Upgrades sub-item `geometry-unchanged`.
//
// Upgrading leaves an emitter's footprint size, redline, and radiator layout the
// same — only its power and heat grow (specs/towers.md). We read an Arc's size,
// redline, and radiator faces before and after upgrading it to level III.

import { newGame, build, tower } from "../_helpers.mjs";

export default function item() {
  let arcId;
  let before;
  let after;

  return {
    id: "upgrades.geometry-unchanged",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      arcId = await build(api, "arc", 12, 12);
      before = await tower(api, arcId);
    },

    // Take it to level III through the real upgrade code, then read the same fields
    // back for comparison.
    async act(api) {
      await api.call("upgradeTower", arcId);
      await api.call("upgradeTower", arcId);
      after = await tower(api, arcId);

      await api.settle(80);
      await api.screenshot("geometry");
    },

    async assert(api, check) {
      check.expectEq("the tower reached level III", after.level, 3);
      check.expectEq("footprint size is unchanged", after.size, before.size);
      check.expectEq("redline is unchanged", after.redline, before.redline);
      check.expectEq(
        "radiator faces are unchanged",
        after.radiatorFaces.join(","),
        before.radiatorFaces.join(","),
      );
    },
  };
}
