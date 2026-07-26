// Automated validation for the Color sub-item `hud-indicator`.
//
// The bottom polarity indicator renders in the ship's current band color and
// changes when the ship flips. The indicator strip (bottom-right of the field) is
// sampled on each band — the brightest painted pixel in the strip is the indicator's
// own color — and the two renders must be visibly distinct.

import { startStageClean, sampleVivid, colorDistance } from "../_helpers.mjs";

export default function item() {
  // The indicator's painted color on each band.
  let cyanHud;
  let magentaHud;

  return {
    id: "color.hud-indicator",

    // A live stage-1 wave with the ship centered; the band itself is posed in `act`,
    // because the item has to read the HUD on BOTH bands and `setShipBand` is a
    // control op that works just as well mid-phase.
    async arrange(api) {
      await startStageClean(api, 1);
      await api.call("setShipX", 640);
    },

    // The polarity swatch/label live in the bottom-right HUD strip (right of the
    // centered resonance meter). Sample a strip wide enough to catch it on either
    // band. Each `settle` is a real pause that guarantees the HUD has repainted on
    // the new band before it is sampled — instant stepping paints no frame at all.
    async act(api) {
      await api.call("setShipBand", "cyan");
      await api.settle(100);
      cyanHud = await sampleVivid(api, 1075, 676, 1245, 700, 18, 5);

      await api.call("setShipBand", "magenta");
      await api.settle(100);
      magentaHud = await sampleVivid(api, 1075, 676, 1245, 700, 18, 5);

      await api.screenshot("indicator");
    },

    async assert(api, check) {
      check.expectGt(
        "the indicator reads a visible band color",
        cyanHud.r + cyanHud.g + cyanHud.b,
        120,
      );
      check.expectGt(
        "the indicator's color changes when the ship flips",
        colorDistance(cyanHud, magentaHud),
        40,
      );
    },
  };
}
