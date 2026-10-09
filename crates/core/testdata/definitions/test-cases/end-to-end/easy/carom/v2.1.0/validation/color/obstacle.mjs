// Automated validation for the Color sub-item `obstacle`: the mid-field obstacles are
// drawn in a distinct, visible color.
//
// The check samples the pixels the build actually RENDERS at obstacle A's center,
// both paddle centers, and an empty patch of field (see validation/_helpers.mjs —
// sampling reads the canvas, not a value the game reports). The obstacle's color must
// stand clearly apart from the field background (so it is visible) and from both
// paddles (so obstacles are not mistaken for a paddle). The exact hue is the model's
// own; only the distinctness is scored.

import {
  actColorSamples,
  arrangeColorScene,
  colorDistance,
} from "../_helpers.mjs";

const VISIBLE_MIN = 50; // clearly different from the field background
const DISTINCT_MIN = 45; // clearly different from either paddle

export default function item() {
  // The colors `act` read off the rendered canvas, for `assert` to compare.
  let samples;

  return {
    id: "color.obstacle",

    // Pose the clean scene: a live match with both paddles centered at cy 360 and
    // every ball parked in a corner. A match opens with the obstacles upright at
    // their base centers, so obstacle A renders solid at its known sample point.
    async arrange(api) {
      await arrangeColorScene(api);
    },

    // Let the posed scene paint, then read every sample point off the canvas. The
    // scene is static, so `act` is also all the clip needs to show: the field with
    // each element in its own color, which is exactly what is checked.
    async act(api) {
      samples = await actColorSamples(api);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the obstacle is drawn in a visible color, distinct from the field background",
        colorDistance(samples.obstacle, samples.background),
        VISIBLE_MIN,
      );
      check.expectGt(
        "the obstacle's color is distinct from the left paddle's",
        colorDistance(samples.obstacle, samples.leftPaddle),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the obstacle's color is distinct from the right paddle's",
        colorDistance(samples.obstacle, samples.rightPaddle),
        DISTINCT_MIN,
      );
    },
  };
}
