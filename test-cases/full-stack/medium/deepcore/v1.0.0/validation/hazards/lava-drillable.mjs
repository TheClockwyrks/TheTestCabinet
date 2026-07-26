// Automated validation for hazards.lava-drillable.
//
// Lava is minable: the drill CAN bore through a lava tile, clearing it to open tunnel, but doing
// so burns a heavy lump of hull (softened by the radiator). We stand the miner over a lava tile
// with a high hull and the lowest radiator, drill down, and confirm the tile clears AND that
// clearing it cost a real chunk of hull.

import {
  teleportInto,
  K,
  newRun,
  standAt,
  SPAWN_COL,
  DEEPSTONE_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let hull0;
  let hull1;
  let cleared = null;

  return {
    id: "hazards.lava-drillable",

    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      await api.call("setTile", col, row + 1, { kind: "lava" }); // lava directly underfoot
      await api.call("setTile", col, row + 2, { kind: "rock" }); // rock under the lava, so it settles after
      await teleportInto(api, col, row);
      await api.call("grantGear", { hull: 5, radiator: 1 }); // 450 hull, refilled; no radiator cut
      hull0 = (await api.snapshot()).miner.hull;
      hull1 = hull0;
    },

    // Drill straight down into the lava and watch for the tile to clear. The sweep stays an
    // explicit loop rather than `api.until` because its predicate reads `tileAt`, not the snapshot.
    async act(api) {
      await api.call("keyDown", K.down);
      for (let i = 0; i < 100; i += 1) {
        await api.advance(3); // 3 ticks = the old 0.05 s chunk
        const t = await api.call("tileAt", col, row + 1);
        if (t && t.kind === "tunnel") {
          cleared = t.kind;
          hull1 = (await api.snapshot()).miner.hull;
          break;
        }
      }
      await api.call("keyUp", K.down);
    },

    async assert(api, check) {
      check.expectEq("lava is drilled away to open tunnel", cleared, "tunnel");
      check.expectGt(
        "boring through lava costs a heavy hull lump",
        hull0 - hull1,
        30,
      );
    },
  };
}
