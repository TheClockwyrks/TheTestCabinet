// Automated validation for movement.grounded-only.
//
// Drilling requires standing on solid ground: a FALLING miner does not drill. We drop the miner
// down an open shaft with the down key held and confirm that, while airborne, it is not grounded
// and no cut is in progress (so a plunge never side-drills or drills the air).

import {
  teleportInto,
  K,
  newRun,
  openColumn,
  solid,
  TOPSOIL_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let snap;

  return {
    id: "movement.grounded-only",

    // The miner unsupported over an open shaft, so it will fall the moment time runs.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await openColumn(api, col, row + 1, row + 4); // open shaft below → the miner falls
      await solid(api, col, row + 5);
    },

    // The plunge with down held is the behavior, and the clip shows the miner falling without ever
    // starting a cut.
    async act(api) {
      await api.call("keyDown", K.down);
      await api.advance(6); // 6 ticks = 0.1 s: still airborne early in the fall
      snap = await api.snapshot();
      await api.call("keyUp", K.down);
    },

    async assert(api, check) {
      check.expectEq(
        "a falling miner is not grounded",
        snap.miner.grounded,
        false,
      );
      check.expectGt("the miner is falling", snap.miner.vy, 0);
      check.expectEq(
        "no cut happens while falling, even holding down",
        snap.miner.drilling,
        null,
      );
    },
  };
}
