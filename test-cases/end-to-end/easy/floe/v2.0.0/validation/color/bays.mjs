// Automated validation for the Color item `bays`.
//
// An open bay renders in a distinct, inviting color, clearly different from the
// solid shore beside it. The check samples the pixels the build actually RENDERS at
// an open bay and at a solid-shore tile between bays, and confirms they read
// distinct. See validation/_helpers.mjs.

import {
  arrangeColorScene,
  actColorSettle,
  sampleStage,
  sampleTile,
  tileCenter,
  colorDistance,
} from "../_helpers.mjs";

export default function item() {
  // The colors `act` read off the rendered canvas, for `assert` to compare.
  let bay;
  let shore;

  return {
    id: "color.bays",

    // Pose the clean scene — a fresh crossing, so every bay is still open.
    async arrange(api) {
      await arrangeColorScene(api);
    },

    // Let the posed scene paint, then sample the bay mouth and the shore beside it.
    // Bay 0 spans columns 3-4; sample toward its mouth. The shore between bays (col 8).
    async act(api) {
      await actColorSettle(api);
      const bayCenter = tileCenter(3, 1); // top-left tile of bay 0
      bay = await sampleStage(api, bayCenter.x + 16, bayCenter.y + 6);
      shore = await sampleTile(api, 8, 1);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "an open bay reads distinct from the solid shore",
        colorDistance(bay, shore),
        22,
      );
    },
  };
}
