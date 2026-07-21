// Automated validation for hazards.gas-detonates.
//
// Drilling into a gas pocket detonates it, dealing hull damage and knocking the miner back. We set
// a gas tile below the miner, drill it, and read the hull drop and the cleared tile back.

import { K, newRun, standAt, SPAWN_COL, ROCKBED_ROW } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let hull0;
  let r;
  let cleared;

  return {
    id: "hazards.gas-detonates",

    // A grounded miner standing over a gas pocket, hulled up enough to survive the blast.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      await api.call("setTile", col, row + 1, { kind: "gas" });
      await api.call("setTile", col, row + 2, { kind: "rock" });
      await api.call("teleport", col, row);
      await api.call("grantGear", { hull: 3 }); // survive the deadly rockbed gas so the knockback reads
      hull0 = (await api.snapshot()).miner.hull;
    },

    // The cut into the pocket and the detonation it triggers are the behavior, and the clip.
    async act(api) {
      await api.call("keyDown", K.down);
      // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk, fine enough to catch the
      // detonation instant rather than a later moment of drilling.
      r = await api.until((s) => s.miner.hull < hull0, { max: 180, poll: 3 });
      await api.call("keyUp", K.down);
      cleared = await api.call("tileAt", col, row + 1);
    },

    async assert(api, check) {
      check.expectLt("the detonation costs hull", r.snap.miner.hull, hull0);
      check.expectEq(
        "the gas tile clears to tunnel",
        cleared ? cleared.kind : null,
        "tunnel",
      );
    },
  };
}
