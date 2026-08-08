// Automated validation for color.miner.
//
// The miner renders in a color clearly distinct from the field behind it. We sample the miner's
// rendered center and a patch of the background sky, and confirm they stand apart.

import {
  newRun,
  minerScreen,
  sampleAt,
  settleStable,
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

    // Sampling reads the painted canvas, so it runs here behind a settle that POLLS until the two
    // points are actually painted rather than pausing a fixed guess — a guess that comes up short
    // on a loaded host reads the previous frame, where both points sit on the same flat patch and
    // a build whose miner is plainly visible is reported as blending into the background.
    async act(api) {
      const snap = await api.snapshot();
      const s = minerScreen(snap.miner, snap.camera);
      const skyPoint = { x: s.x, y: VIEWPORT_Y + 40 }; // a patch of sky above the ground line
      await settleStable(api, [s, skyPoint]);

      minerColor = await sampleAt(api, s.x, s.y, "the miner");
      sky = await sampleAt(
        api,
        skyPoint.x,
        skyPoint.y,
        "the sky behind the miner",
      );
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
