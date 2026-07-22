// Automated validation for weight.drop-to-lift.
//
// Dropping ore from the inventory until the load falls under the lift limit clears the overload, and
// the miner can climb again. We overload the bay, drop units through the real inventory-drop path
// until it is liftable, then thrust and confirm the miner rises.

import {
  teleportInto,
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
  let overloaded;
  let lightened;
  let after;

  return {
    id: "weight.drop-to-lift",

    // An overloaded miner at the bottom of an open shaft it cannot currently climb.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await openColumn(api, col, row - 10, row - 1);
      await solid(api, col, row + 1);
      await teleportInto(api, col, row);
      await api.call("addCargo", "pyronium", 7); // ~406 kg — overloaded
      overloaded = (await api.snapshot()).miner.overloaded;
    },

    // Dropping the ore and the climb it unlocks are both the behavior, so the clip shows the load
    // being shed and the miner lifting off.
    async act(api) {
      await api.call("dropOre", "pyronium");
      await api.call("dropOre", "pyronium");
      await api.call("dropOre", "pyronium"); // down to ~232 kg — clearly liftable
      lightened = (await api.snapshot()).miner.overloaded;

      await api.call("keyDown", K.thrust);
      await api.advance(48); // 48 ticks = 0.8 s
      after = await api.snapshot();
      await api.call("keyUp", K.thrust);
    },

    async assert(api, check) {
      check.expectEq("starts overloaded", overloaded, true);
      check.expectEq("dropping ore clears the overload", lightened, false);
      check.expectLt("the lightened miner climbs again", after.miner.vy, -50);
    },
  };
}
