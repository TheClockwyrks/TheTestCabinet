// Automated validation for color.lava.
//
// Lava renders in a distinct, bright color clearly different from the surrounding rock, so it is
// plainly visible. We sample the pixels of a lava tile and an adjacent plain rock tile.

import {
  teleportInto,
  newRun,
  solid,
  sampleTile,
  settleTiles,
  colorDistance,
  SPAWN_COL,
  DEEPSTONE_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let lava;
  let rock;

  return {
    id: "color.lava",

    // Put a lava tile and a plain rock tile side by side in view of the camera.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await api.call("setTile", col + 2, row, { kind: "lava" });
      await solid(api, col + 3, row);
    },

    // Pixel sampling reads the painted canvas, so it belongs here behind a settle — the validate
    // pass advances time instantly and paints no frame of its own. The settle POLLS until the two
    // tiles have actually been painted rather than pausing a fixed guess: a short guess that comes
    // up on a loaded host reads the previous frame, where both points land on the same flat patch
    // and the check reports a distance of 0 against a build that drew the lava correctly.
    async act(api) {
      await settleTiles(api, [
        [col + 2, row],
        [col + 3, row],
      ]);
      lava = await sampleTile(api, col + 2, row);
      rock = await sampleTile(api, col + 3, row);
      await api.screenshot("lava");
    },

    async assert(api, check) {
      check.expectGt(
        "lava is plainly distinct from the rock",
        colorDistance(lava, rock),
        60,
      );
    },
  };
}
