// Automated validation for hazards.gas-hidden.
//
// A gas pocket renders with the same band-rock texture as ordinary rock (its only tell is a subtle
// seep VFX), so it cannot be told from plain rock by color alone — unlike the plainly-visible lava.
// We sample the rendered pixels of a gas tile, a plain rock tile, and a lava tile side by side.

import {
  teleportInto,
  newRun,
  SPAWN_COL,
  ROCKBED_ROW,
  sampleTile,
  settleTiles,
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
      await teleportInto(api, col, row);
      await api.call("setTile", col + 1, row, { kind: "gas" });
      await api.call("setTile", col + 2, row, { kind: "rock" });
      await api.call("setTile", col + 3, row, { kind: "lava" });
    },

    // Sampling reads the painted canvas, so it runs here behind a settle that POLLS until all
    // three tiles are painted, rather than pausing a fixed guess.
    //
    // This item needs that more than any other, because its first assertion is that two things
    // look ALIKE. On a stale frame every sample lands on the same flat patch, so gas-vs-rock comes
    // back as 0 and the check PASSES a build that painted nothing at all — the failure mode is a
    // false pass, not a false failure, and nothing downstream would ever question it. Waiting for
    // the paint is what makes the "hidden" claim mean anything.
    async act(api) {
      await settleTiles(api, [
        [col + 1, row],
        [col + 2, row],
        [col + 3, row],
      ]);
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
