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
      await api.call("grantGear", { hull: 5, radiator: 1 }); // tier-5 450 hull; no radiator cut
      // Fill the hull explicitly: a build that raises the ceiling without granting the capacity
      // leaves the miner on `100/450`, and the `60` hull lump for a deepstone bore plus the contact
      // drain on the way can end the run mid-cut — reported here as "lava is not drillable". The
      // grant contract has its own item, `economy.grant-applies-tiers`.
      await api.call("setHull", 100000);
      hull0 = (await api.snapshot()).miner.hull;
      hull1 = hull0;
    },

    // Drill straight down into the lava and watch for the tile to clear. The sweep stays an
    // explicit loop rather than `api.until` because its predicate reads `tileAt`, not the snapshot.
    //
    // The loop breaks on the first sample where the cell reads `tunnel`, which is the right instant
    // to read the hull but leaves the clip ending on the frame the lava disappears — so the thing
    // the item is named for, lava BECOMING open tunnel, is never on screen. The lead-in holds the
    // intact pool and the tail holds the bored-through tunnel and the hull lump it cost. The 200
    // iterations (600 ticks = 10 s) are far past the `1.50 s` a tier-1 drill needs for a deepstone
    // tile (`specs/upgrades.md`), so a slower-than-table drill fails `fuel.drill-cost` rather than
    // reporting here that lava is unminable.
    async act(api) {
      await api.advance(30); // 30 ticks = 0.5 s with the pool intact and the hull full
      await api.call("keyDown", K.down);
      for (let i = 0; i < 200; i += 1) {
        await api.advance(3); // 3 ticks = the old 0.05 s chunk
        const t = await api.call("tileAt", col, row + 1);
        if (t && t.kind === "tunnel") {
          cleared = t.kind;
          hull1 = (await api.snapshot()).miner.hull;
          break;
        }
      }
      await api.call("keyUp", K.down);
      await api.advance(90); // 90 ticks = 1.5 s on the cleared tunnel and the hull it cost
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
