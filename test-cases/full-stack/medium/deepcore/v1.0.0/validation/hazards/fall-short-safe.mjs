// Automated validation for hazards.fall-short-safe.
//
// A drop of a tile or two lands under the safe threshold and deals no impact damage. We drop the
// miner a single tile onto a floor and confirm the hull is unchanged on landing.

import { teleportInto, newRun, SPAWN_COL, TOPSOIL_ROW } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let hull0;
  let r;

  return {
    id: "hazards.fall-short-safe",

    // The miner poised over a single open tile with a floor immediately below it.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col, row + 1, { kind: "tunnel" }); // one open tile below
      await api.call("setTile", col, row + 2, { kind: "rock" }); // floor a single tile down
      await teleportInto(api, col, row);
      hull0 = (await api.snapshot()).miner.hull;
    },

    async act(api) {
      // 90 ticks = the old 1.5 s cap; poll 3 = the old 0.05 s chunk, fine enough to read the hull
      // at the landing itself.
      r = await api.until((s) => s.miner.grounded && s.miner.row > row, {
        max: 90,
        poll: 3,
      });
    },

    async assert(api, check) {
      check.expectOk("the miner landed", r.hit);
      check.expectClose(
        "a short drop does no hull damage",
        r.snap.miner.hull,
        hull0,
        0.01,
      );
    },
  };
}
