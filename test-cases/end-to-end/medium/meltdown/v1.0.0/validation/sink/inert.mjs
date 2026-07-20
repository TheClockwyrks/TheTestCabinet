// Automated validation for the Sink sub-item `inert`.
//
// The Sink has no heat of its own and deals no damage — it never fires at the surge
// (specs/towers.md). A Sink is placed beside the lane with a real Core in range and
// the sim is run forward; the Sink reports heat 0, damage 0, and is never firing.

import { newGame, build, spawn, tower } from "../_helpers.mjs";

export default function item() {
  let sinkId;
  let t;

  return {
    id: "sink.inert",

    // A Sink right on the lane with a real Core walking into its range — if it were
    // ever going to fire or gain heat, this is the setup that would show it.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      sinkId = await build(api, "sink", 3, 20);
      await spawn(api, "core", "left");
    },

    // 60 ticks = the old 1s of the real combat systems running with a target in range.
    async act(api) {
      await api.advance(60);
      t = await tower(api, sinkId);
      await api.settle(80);
      await api.screenshot("inert");
    },

    async assert(api, check) {
      check.expectClose("a Sink has no heat", t.heat, 0, 0.01);
      check.expectClose("a Sink deals no damage", t.damage, 0, 0.01);
      check.expectEq("a Sink never fires", t.firing, false);
    },
  };
}
