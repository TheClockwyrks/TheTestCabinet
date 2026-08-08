// Automated validation for the Color sub-item `hud-indicator`.
//
// The bottom polarity indicator renders in the ship's current band color and
// changes when the ship flips. The indicator strip (bottom-right of the field) is
// sampled on each band and the two renders must be visibly distinct.
//
// WHY THE BAND IS READ BY SATURATION, NOT BRIGHTNESS. The old check took the
// BRIGHTEST painted pixel in the strip (`sampleVivid`). But the indicator is a
// swatch AND a label (`specs/playfield.md`: "a bold swatch in your current band's
// color and glyph with its label"), and a build is free to draw that label in plain
// white — which is brighter than any band color. On such a build the sampler
// locked onto the same white text on both bands and reported a color distance of
// 0: "the indicator never changes", for an indicator that changes exactly as
// specified. The reading of 765 (a flat 255,255,255) is the giveaway — that is not
// a band color, it is text.
//
// `sampleSaturated` takes the most CHROMATIC pixel bright enough to carry a hue, so
// it finds the swatch and ignores neutral text however bright. `color/ship-band`
// already reads the ship this way, for exactly this reason; the indicator has the
// same shape of problem and was still on the old sampler.
//
// The visibility assertion changes with it. "Is anything bright here?" was only ever
// satisfied by the white label, so it passed on builds whose swatch this item could
// not see at all. It now asks whether what was found is CHROMATIC — a band color
// rather than a grey — which is what "renders in the ship's current band color"
// actually claims.

import {
  startStageClean,
  sampleSaturated,
  colorDistance,
} from "../_helpers.mjs";

// The bottom-right strip the swatch and its label live in (`specs/playfield.md`:
// the polarity indicator sits toward the right of the strip at y 656..720).
const STRIP = { x0: 1040, y0: 672, x1: 1248, y1: 706 };
const GRID_X = 22;
const GRID_Y = 7;

// How far the sampled color must sit from a grey of the same brightness to count
// as a band color rather than neutral chrome. On the 0..441 RGB distance scale
// this is a modest but unmistakable tint.
const CHROMA_MIN = 40;

// Euclidean RGB distance between the two bands' renders, on the same 0..441 scale.
const CHANGE_MIN = 40;

/** How far `c` sits from the grey of its own brightness — its chroma. */
function chroma(c) {
  const mean = (c.r + c.g + c.b) / 3;
  return colorDistance(c, { r: mean, g: mean, b: mean });
}

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

    // Each `settle` is a real pause that guarantees the HUD has repainted on the new
    // band before it is sampled — instant stepping paints no frame at all.
    async act(api) {
      await api.call("setShipBand", "cyan");
      await api.settle(100);
      cyanHud = await sampleSaturated(
        api,
        STRIP.x0,
        STRIP.y0,
        STRIP.x1,
        STRIP.y1,
        GRID_X,
        GRID_Y,
      );

      await api.call("setShipBand", "magenta");
      await api.settle(100);
      magentaHud = await sampleSaturated(
        api,
        STRIP.x0,
        STRIP.y0,
        STRIP.x1,
        STRIP.y1,
        GRID_X,
        GRID_Y,
      );

      await api.screenshot("indicator");
    },

    async assert(api, check) {
      check.expectGt(
        "the indicator is drawn in a band color, not neutral chrome (distance from grey)",
        chroma(cyanHud),
        CHROMA_MIN,
      );
      check.expectGt(
        "the indicator's color changes when the ship flips (RGB distance between the two bands)",
        colorDistance(cyanHud, magentaHud),
        CHANGE_MIN,
      );
    },
  };
}
