// Automated validation for color.stone.
//
// An unbreakable-stone boulder renders in a color distinct from the diggable band dirt around it, so
// it is not mistaken for ordinary rock. We sample a stone tile and an adjacent topsoil rock tile.

import {
  teleportInto,
  newRun,
  solid,
  sampleTile,
  settleTiles,
  colorDistance,
  SPAWN_COL,
  TOPSOIL_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let stone;
  let rock;

  return {
    id: "color.stone",

    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col + 2, row, { kind: "stone" });
      await solid(api, col + 3, row);
    },

    // Sampling reads the painted canvas, so it runs here behind a settle that POLLS until the two
    // tiles are actually painted — a fixed pause reads the previous frame on a loaded host, where
    // both points land on the same flat patch and the distance collapses to 0.
    async act(api) {
      await settleTiles(api, [
        [col + 2, row],
        [col + 3, row],
      ]);
      stone = await sampleTile(api, col + 2, row);
      rock = await sampleTile(api, col + 3, row);
      await api.screenshot("stone");
    },

    async assert(api, check) {
      check.expectGt(
        "stone is distinct from the band dirt",
        colorDistance(stone, rock),
        28,
      );
    },
  };
}
