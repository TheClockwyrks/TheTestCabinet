// Automated validation for materials.collect.
//
// Drilling a material node collects the exotic material into the satchel. We place a Resonite node
// below the miner, drill it, and read the satchel back.

import {
  teleportInto,
  K,
  newRun,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let start;
  let r;
  let cleared;

  return {
    id: "materials.collect",

    // An empty satchel, standing over a Resonite node with rock beneath it.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col, row + 1, {
        kind: "material",
        material: "resonite",
      });
      await api.call("setTile", col, row + 2, { kind: "rock" });
      await teleportInto(api, col, row);
      start = (await api.snapshot()).satchel.resonite;
    },

    // Drill until the material lands in the satchel — the collection is what is checked and shown.
    async act(api) {
      await api.call("keyDown", K.down);
      // 120 ticks = the old 2 s cap; poll 3 = the old 0.05 s chunk, fine enough to read the satchel
      // at the instant the node is banked.
      r = await api.until((s) => s.satchel.resonite > 0, { max: 120, poll: 3 });
      await api.call("keyUp", K.down);
      cleared = await api.call("tileAt", col, row + 1);
    },

    async assert(api, check) {
      check.expectEq("the satchel starts without Resonite", start, 0);
      check.expectEq(
        "drilling the node banks the Resonite",
        r.snap.satchel.resonite,
        1,
      );
      check.expectEq(
        "the node tile clears to tunnel",
        cleared ? cleared.kind : null,
        "tunnel",
      );
    },
  };
}
