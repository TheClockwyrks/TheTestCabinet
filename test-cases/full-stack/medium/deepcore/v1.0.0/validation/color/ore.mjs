// Automated validation for color.ore.
//
// An ore vein renders in a color clearly distinct from the plain band rock around it. We set a bright
// ore against topsoil rock and confirm the vein registers somewhere across the tile (its smear may
// cover only part of the tile) against the plain-rock color.

import {
  teleportInto,
  newRun,
  solid,
  sampleTile,
  settleTiles,
  tileMaxDistFrom,
  SPAWN_COL,
  TOPSOIL_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let oreDist;

  return {
    id: "color.ore",

    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col + 2, row, { kind: "ore", ore: "cuprite" });
      await solid(api, col + 3, row);
    },

    // Sampling reads the painted canvas, so it runs here behind a settle that POLLS until the
    // vein and the plain rock beside it are actually painted — a fixed pause reads the previous
    // frame on a loaded host, where both land on the same flat patch and the vein reads as
    // indistinguishable from rock though the build drew it clearly.
    async act(api) {
      await settleTiles(api, [
        [col + 2, row],
        [col + 3, row],
      ]);
      const rock = await sampleTile(api, col + 3, row);
      oreDist = await tileMaxDistFrom(api, col + 2, row, rock);
      await api.screenshot("ore");
    },

    async assert(api, check) {
      check.expectGt("an ore vein reads against plain rock", oreDist, 30);
    },
  };
}
