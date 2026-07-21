// Automated validation for hazards.gas-hidden.
//
// A gas pocket renders with the same band-rock texture as ordinary rock (its only tell is a subtle
// seep VFX), so it cannot be told from plain rock by color alone — unlike the plainly-visible lava.
// We sample the rendered pixels of a gas tile, a plain rock tile, and a lava tile side by side.

import {
  newRun,
  SPAWN_COL,
  ROCKBED_ROW,
  sampleTile,
  colorDistance,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let gas;
  let rock;
  let lava;

  return {
    id: "hazards.gas-hidden",

    // The three tiles laid out side by side in view, so one camera framing shows all of them.
    async arrange(api) {
      await newRun(api);
      await api.call("teleport", col, row);
      await api.call("setTile", col + 1, row, { kind: "gas" });
      await api.call("setTile", col + 2, row, { kind: "rock" });
      await api.call("setTile", col + 3, row, { kind: "lava" });
    },

    // Sampling reads the painted canvas, so it runs here behind a real settle — the validate pass
    // advances time instantly and paints no frame of its own.
    async act(api) {
      await api.settle(150);
      gas = await sampleTile(api, col + 1, row);
      rock = await sampleTile(api, col + 2, row);
      lava = await sampleTile(api, col + 3, row);
      await api.screenshot("hidden");
    },

    async assert(api, check) {
      check.expectLt(
        "gas renders like plain rock (hidden)",
        colorDistance(gas, rock),
        35,
      );
      check.expectGt(
        "gas is NOT drawn like the obvious lava hazard",
        colorDistance(gas, lava),
        60,
      );
    },
  };
}
