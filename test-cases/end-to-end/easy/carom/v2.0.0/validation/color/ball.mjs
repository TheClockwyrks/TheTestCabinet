// Automated validation for the Color sub-item `ball`: the ball is drawn in a
// distinct, visible color (overview.md gives it `#f2f5f7`).
//
// The check samples the pixels the build actually RENDERS at the ball's posed
// position and at an empty patch of field (see validation/_helpers.mjs — sampling
// reads the canvas, not a value the game reports). The ball's color must stand
// clearly apart from the field background so it is legible in play. The exact hue is
// the model's own; only the distinctness is scored.

import {
  actColorSamples,
  arrangeColorScene,
  colorDistance,
} from "../_helpers.mjs";

const VISIBLE_MIN = 50; // clearly different from the field background

export default function item() {
  let samples;

  return {
    id: "color.ball",

    // Pose the clean color scene: a live match with the paddles centered and ball 0
    // at the mid-field ball sample point, clear of the paddles, obstacles, and net.
    async arrange(api) {
      await arrangeColorScene(api);
    },

    async act(api) {
      samples = await actColorSamples(api);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the ball is drawn in a visible color, distinct from the field background",
        colorDistance(samples.ball, samples.background),
        VISIBLE_MIN,
      );
    },
  };
}
