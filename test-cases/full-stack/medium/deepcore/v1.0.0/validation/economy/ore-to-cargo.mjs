// Automated validation for economy.ore-to-cargo.
//
// Drilling an ore vein banks one unit into the cargo bay, using one slot. We set an ore tile below
// the miner, drill it, and read the cargo back.

import { K, newRun, SPAWN_COL, TOPSOIL_ROW } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let empty;
  let r;

  return {
    id: "economy.ore-to-cargo",

    // An empty bay, standing over a ferron vein with rock beneath it.
    async arrange(api) {
      await newRun(api);
      await api.call("teleport", col, row);
      await api.call("setTile", col, row + 1, { kind: "ore", ore: "ferron" });
      await api.call("setTile", col, row + 2, { kind: "rock" });
      await api.call("teleport", col, row);
      empty = (await api.snapshot()).cargo.slotsUsed;
    },

    // Drill until the ore lands in the bay — the collection is what the item checks and shows.
    async act(api) {
      await api.call("keyDown", K.down);
      // 120 ticks = the old 2 s cap; poll 3 = the old 0.05 s chunk, fine enough to catch the
      // instant the unit is banked rather than a moment of drilling later.
      r = await api.until((s) => s.cargo.slotsUsed > 0, { max: 120, poll: 3 });
      await api.call("keyUp", K.down);
    },

    async assert(api, check) {
      check.expectEq("the bay starts empty", empty, 0);
      check.expectEq("drilling ore fills one slot", r.snap.cargo.slotsUsed, 1);
      check.expectEq("the ferron unit is banked", r.snap.cargo.ore.ferron, 1);
    },
  };
}
