// Automated validation for movement.fall-free.
//
// Falling through open tunnel is free: an unsupported miner falls under gravity and pays no
// thrust/drill fuel — only the small passive underground trickle. We drop the miner with no keys
// held and confirm it accelerates downward while fuel barely moves (far less than a thrust burn).

import {
  newRun,
  openColumn,
  solid,
  TOPSOIL_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let fuel0;
  let snap;

  return {
    id: "movement.fall-free",

    // The miner unsupported at the top of an open shaft, with a floor well below.
    async arrange(api) {
      await newRun(api);
      await api.call("teleport", col, row);
      await openColumn(api, col, row + 1, row + 6);
      await solid(api, col, row + 7);
      fuel0 = (await api.snapshot()).miner.fuel;
    },

    // The fall itself is the behavior, and the clip shows the miner dropping with nothing held.
    async act(api) {
      await api.advance(30); // 30 ticks = 0.5 s of free-fall, no keys held
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectGt("the miner is falling", snap.miner.vy, 50);
      const fuelDrop = fuel0 - snap.miner.fuel;
      // 0.5s of the underground trickle is ~0.2 fuel; a thrust burn over the same time would be >1.
      check.expectLt("falling itself costs no thrust fuel", fuelDrop, 0.35);
    },
  };
}
