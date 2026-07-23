// Automated validation for hazards.lava-drains.
//
// Touching lava drains hull quickly. We stand the miner on a lava tile and step the real sim,
// reading the hull drop over half a second (no radiator).

import {
  teleportInto,
  newRun,
  SPAWN_COL,
  DEEPSTONE_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let hull0;
  let snap;

  return {
    id: "hazards.lava-drains",

    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col, row + 1, { kind: "lava" }); // lava underfoot
      await teleportInto(api, col, row);
      hull0 = (await api.snapshot()).miner.hull;
    },

    // The drain is the behavior, and the clip shows the hull bar falling in contact with the lava.
    async act(api) {
      await api.advance(30); // 30 ticks = 0.5 s
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectLt("lava drains hull", snap.miner.hull, hull0);
      check.expectGt("lava drains hull fast", hull0 - snap.miner.hull, 5);
    },
  };
}
