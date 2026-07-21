// Automated validation for color.stone.
//
// An unbreakable-stone boulder renders in a color distinct from the diggable band dirt around it, so
// it is not mistaken for ordinary rock. We sample a stone tile and an adjacent topsoil rock tile.

import {
  newRun,
  solid,
  sampleTile,
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
      await api.call("teleport", col, row);
      await api.call("setTile", col + 2, row, { kind: "stone" });
      await solid(api, col + 3, row);
    },

    // Sampling reads the painted canvas, so it runs here behind a real settle.
    async act(api) {
      await api.settle(120);
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
