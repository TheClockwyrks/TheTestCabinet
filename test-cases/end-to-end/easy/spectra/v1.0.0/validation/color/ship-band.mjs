// Automated validation for the Color sub-item `ship-band`.
//
// The ship renders in its current band's color, and that color changes when it
// flips. The ship is posed on each band and the pixels it PAINTS at the ship's
// position sampled; the two renders must be visibly distinct (and each distinct
// from the field), so the ship reads its band by color.

import {
  startStageClean,
  sampleVivid,
  sampleSaturated,
  colorDistance,
  SHIP_Y,
} from "../_helpers.mjs";

export default function item() {
  // The ship's painted band color on each band, and the field behind it.
  let cyanShip;
  let magentaShip;
  let bg;

  return {
    id: "color.ship-band",

    // A live stage-1 wave with the ship centered. The band is posed in `act` because
    // both bands have to be sampled, and `setShipBand` is a control op that consumes
    // no time and so is equally legal mid-phase.
    async arrange(api) {
      await startStageClean(api, 1);
      await api.call("setShipX", 640);
    },

    // Read the ship's BAND by its most-saturated painted pixel: the fighter keeps a
    // neutral white hull (the brightest pixel, unchanging across bands), so its band
    // is told by the tinted accents/glyph, which is what a player reads too. Each
    // `settle` guarantees the ship has repainted on the new band before it is read.
    async act(api) {
      await api.call("setShipBand", "cyan");
      await api.settle(100);
      cyanShip = await sampleSaturated(api, 616, SHIP_Y - 22, 664, SHIP_Y + 22);

      await api.call("setShipBand", "magenta");
      await api.settle(100);
      magentaShip = await sampleSaturated(
        api,
        616,
        SHIP_Y - 22,
        664,
        SHIP_Y + 22,
      );

      bg = await sampleVivid(api, 600, 440, 680, 500);
      await api.screenshot("ship");
    },

    async assert(api, check) {
      check.expectGt(
        "the cyan-band ship is drawn in a visible color",
        colorDistance(cyanShip, bg),
        50,
      );
      check.expectGt(
        "the ship's color changes when it flips",
        colorDistance(cyanShip, magentaShip),
        40,
      );
    },
  };
}
