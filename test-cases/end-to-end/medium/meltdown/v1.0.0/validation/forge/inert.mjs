// Automated validation for the Forge sub-item `inert`.
//
// The Forge has no heat of its own and deals no damage — it never fires at the surge
// (specs/towers.md). A Forge is placed beside the lane with a real Core in range and
// the sim is run forward; the Forge reports heat 0, damage 0, and is never firing.

import { newGame, build, spawn, tower } from "../_helpers.mjs";

export default function item() {
  let forgeId;
  let t;

  return {
    id: "forge.inert",

    // A Forge right on the lane with a real Core walking into its range — if it were
    // ever going to fire or gain heat, this is the setup that would show it.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      forgeId = await build(api, "forge", 3, 20);
      await spawn(api, "core", "left");
    },

    // 60 ticks = the old 1s of the real combat systems running with a target in range.
    async act(api) {
      await api.advance(60);
      t = await tower(api, forgeId);
      await api.settle(80);
      await api.screenshot("inert");
    },

    async assert(api, check) {
      check.expectClose("a Forge has no heat", t.heat, 0, 0.01);
      check.expectClose("a Forge deals no damage", t.damage, 0, 0.01);
      check.expectEq("a Forge never fires", t.firing, false);
    },
  };
}
