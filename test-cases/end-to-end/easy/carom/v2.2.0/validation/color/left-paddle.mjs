// Automated validation for the Color sub-item `left-paddle`: the left (player one)
// paddle is drawn in a distinct, visible color.
//
// The check samples the pixels the build actually RENDERS at the left paddle's
// center, the right paddle's center, and an empty patch of field (see
// validation/_helpers.mjs — sampling reads the canvas, not a value the game
// reports). The left paddle's color must stand clearly apart from the field
// background (so it is visible) and from the right paddle (so the two players are
// told apart). The exact hue is the model's own; only the distinctness is scored.

import {
  actColorSamples,
  arrangeColorScene,
  colorDistance,
} from "../_helpers.mjs";

const VISIBLE_MIN = 50; // clearly different from the field background
const DISTINCT_MIN = 45; // clearly different from the other player's paddle

export default function item() {
  // The colors `act` read off the rendered canvas, for `assert` to compare.
  let samples;

  return {
    id: "color.left-paddle",

    // Pose the clean scene: a live match with both paddles centered at cy 360 and
    // every ball parked in a corner, so each sample point renders an unobstructed,
    // solid color.
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
        "the left paddle is drawn in a visible color, distinct from the field background",
        colorDistance(samples.leftPaddle, samples.background),
        VISIBLE_MIN,
      );
      check.expectGt(
        "the left paddle's color is distinct from the right paddle's (the players are told apart)",
        colorDistance(samples.leftPaddle, samples.rightPaddle),
        DISTINCT_MIN,
      );
    },
  };
}
