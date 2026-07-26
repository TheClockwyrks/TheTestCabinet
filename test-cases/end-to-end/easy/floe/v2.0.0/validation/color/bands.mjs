// Automated validation for the Color item `bands`.
//
// The water band, the ice band, and the median each render in a distinct color.
// The check samples the pixels the build actually RENDERS at a cleared water tile,
// a cleared ice tile, and a median tile, and confirms the three read distinct. The
// exact palette is the model's own; only the distinctness is scored. See
// validation/_helpers.mjs.

import {
  arrangeColorScene,
  actColorSettle,
  sampleTile,
  colorDistance,
} from "../_helpers.mjs";

const DISTINCT = 30;

export default function item() {
  // The colors `act` read off the rendered canvas, for `assert` to compare.
  let water;
  let ice;
  let median;

  return {
    id: "color.bands",

    // Pose the clean scene: a fresh crossing with a water row and an ice row cleared,
    // so each band's own color renders unobstructed at the sample points.
    async arrange(api) {
      await arrangeColorScene(api);
    },

    // Let the posed scene paint, then read each sample point off the canvas. The
    // scene is static, so `act` is also all the clip needs to show: the three bands
    // in their own colors, which is exactly what is checked.
    async act(api) {
      await actColorSettle(api);
      water = await sampleTile(api, 10, 5); // cleared open water
      ice = await sampleTile(api, 10, 15); // cleared road
      median = await sampleTile(api, 5, 10); // median shelf
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the water band reads distinct from the ice band",
        colorDistance(water, ice),
        DISTINCT,
      );
      check.expectGt(
        "the water band reads distinct from the median",
        colorDistance(water, median),
        DISTINCT,
      );
      check.expectGt(
        "the ice band reads distinct from the median",
        colorDistance(ice, median),
        DISTINCT,
      );
    },
  };
}
