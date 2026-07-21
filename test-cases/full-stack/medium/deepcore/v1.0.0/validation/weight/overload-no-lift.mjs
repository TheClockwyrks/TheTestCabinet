// Automated validation for weight.overload-no-lift.
//
// When the cargo weight meets or exceeds the jetpack's lift limit the miner is OVERLOADED: thrust
// can only slow the descent, not climb. We load past the tier-1 lift limit, confirm the overload
// flag, then hold thrust and confirm the miner does not rise.

import {
  K,
  newRun,
  openColumn,
  solid,
  DEEPSTONE_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let before;
  let after;

  return {
    id: "weight.overload-no-lift",

    // An over-limit haul at the bottom of an open shaft, so nothing but weight stops the climb.
    async arrange(api) {
      await newRun(api);
      await api.call("teleport", col, row);
      await openColumn(api, col, row - 10, row - 1);
      await solid(api, col, row + 1);
      await api.call("teleport", col, row);
      await api.call("addCargo", "pyronium", 7); // ~406 kg — over the 350 kg tier-1 lift limit
      before = await api.snapshot();
    },

    // The sustained thrust is the behavior, and the clip shows the miner straining without rising.
    async act(api) {
      await api.call("keyDown", K.thrust);
      await api.advance(60); // 60 ticks = 1 s
      after = await api.snapshot();
      await api.call("keyUp", K.thrust);
    },

    async assert(api, check) {
      check.expectEq(
        "the load exceeds lift — OVERLOADED",
        before.miner.overloaded,
        true,
      );
      check.expectGe("an overloaded miner cannot climb", after.miner.row, row);
      check.expectGt("thrust cannot pull it upward", after.miner.vy, -20);
    },
  };
}
