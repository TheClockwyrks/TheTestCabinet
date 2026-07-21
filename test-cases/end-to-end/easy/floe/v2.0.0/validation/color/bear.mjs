// Automated validation for the Color item `bear`.
//
// The bear renders in a distinct, visible color, clearly different from the strait
// tile beneath it. The check samples the pixels the build actually RENDERS at the
// bear (posed on the cleared road) and at an empty road tile, and confirms they
// read distinct. See validation/_helpers.mjs.

import {
  arrangeColorScene,
  actColorSettle,
  sampleTile,
  colorDistance,
} from "../_helpers.mjs";

export default function item() {
  // The colors `act` read off the rendered canvas, for `assert` to compare.
  let bear;
  let field;

  return {
    id: "color.bear",

    // Pose the clean scene, which parks the bear at (24, 15) on the cleared road so
    // it renders unobstructed against a plain tile.
    async arrange(api) {
      await arrangeColorScene(api);
    },

    // Let the posed scene paint, then read the bear and an empty road tile.
    async act(api) {
      await actColorSettle(api);
      bear = await sampleTile(api, 24, 15);
      field = await sampleTile(api, 12, 15); // empty road
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the bear reads distinct from the road beneath it",
        colorDistance(bear, field),
        30,
      );
    },
  };
}
