// Automated validation for color.miner.
//
// The miner renders in a color clearly distinct from the field behind it. We sample the miner's
// rendered center and a patch of the background sky, and confirm they stand apart.

import {
  newRun,
  minerScreen,
  sampleAt,
  colorDistance,
  VIEWPORT_Y,
} from "../_helpers.mjs";

export default function item() {
  let minerColor;
  let sky;

  return {
    id: "color.miner",

    async arrange(api) {
      await newRun(api); // miner idle on the surface, sky behind it
    },

    // Sampling reads the painted canvas, so it runs here behind a real settle.
    async act(api) {
      await api.settle(150);
      const snap = await api.snapshot();
      const s = minerScreen(snap.miner, snap.camera);

      minerColor = await sampleAt(api, s.x, s.y);
      sky = await sampleAt(api, s.x, VIEWPORT_Y + 40); // a patch of sky above the ground line
      await api.screenshot("miner");
    },

    async assert(api, check) {
      check.expectGt(
        "the miner stands out from the background",
        colorDistance(minerColor, sky),
        40,
      );
    },
  };
}
