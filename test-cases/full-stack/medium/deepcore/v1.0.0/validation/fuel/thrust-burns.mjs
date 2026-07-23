// Automated validation for fuel.thrust-burns.
//
// Holding thrust burns fuel while it lifts the miner. We open a shaft above, hold thrust, run the
// real sim forward, and confirm the miner rises while fuel drops far more than the passive trickle.

import {
  teleportInto,
  K,
  newRun,
  openColumn,
  solid,
  ROCKBED_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let fuel0;
  let snap;

  return {
    id: "fuel.thrust-burns",

    // A full tank on a grounded miner with open shaft above it to climb into.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await openColumn(api, col, row - 4, row - 1); // open above so the miner can climb
      await solid(api, col, row + 1);
      await teleportInto(api, col, row);
      await api.call("setFuel", 999); // top off (clamped to max)
      fuel0 = (await api.snapshot()).miner.fuel;
    },

    // The burn is the behavior, and the clip shows the miner actually lifting off.
    async act(api) {
      await api.call("keyDown", K.thrust);
      await api.advance(30); // 30 ticks = 0.5 s
      snap = await api.snapshot();
      await api.call("keyUp", K.thrust);
    },

    async assert(api, check) {
      check.expectLt("thrust lifts the miner upward", snap.miner.vy, 0);
      check.expectGt("thrust burns real fuel", fuel0 - snap.miner.fuel, 1.5);
    },
  };
}
