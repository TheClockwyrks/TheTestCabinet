// Automated validation for the Color item `critter`.
//
// The critter renders in a distinct, visible color, clearly different from the
// strait tile beneath it. The check samples the pixels the build actually RENDERS
// at the critter (posed on the median) and at an empty median tile, and confirms
// they read distinct. See validation/_helpers.mjs.

import {
  arrangeColorScene,
  actColorSettle,
  sampleTile,
  colorDistance,
} from "../_helpers.mjs";

export default function item() {
  // The colors `act` read off the rendered canvas, for `assert` to compare.
  let critter;
  let field;

  return {
    id: "color.critter",

    // Pose the clean scene, which parks the critter at (20, 10) on the median so it
    // renders unobstructed against a plain tile.
    async arrange(api) {
      await arrangeColorScene(api);
    },

    // Let the posed scene paint, then read the critter and an empty median tile.
    async act(api) {
      await actColorSettle(api);
      critter = await sampleTile(api, 20, 10);
      field = await sampleTile(api, 5, 10); // empty median
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the critter reads distinct from the median beneath it",
        colorDistance(critter, field),
        40,
      );
    },
  };
}
