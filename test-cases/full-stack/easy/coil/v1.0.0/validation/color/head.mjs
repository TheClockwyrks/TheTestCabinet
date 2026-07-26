// Automated validation for the Color sub-item `head`.
//
// The snake's head is drawn in a distinct, visible color. The check samples the pixels
// the build actually RENDERS at the head cell, a straight body cell, and an empty board
// patch (see _helpers.mjs — sampling reads the canvas, not a value the game reports).
// The head must stand clearly apart from the board background (so it is visible) and
// from the body (so the head is not mistaken for a body segment). The exact hue is the
// model's own; only the distinctness is scored.
//
// Posing the scene is instant (`arrange`); the repaint the samples need consumes real
// time, so the settle and the sampling are `act` — which is also all the clip has to
// show, since the scene is static and is exactly what is checked.

import {
  actColorSamples,
  arrangeColorScene,
  colorDistance,
  VISIBLE_MIN,
  HEAD_BODY_MIN,
} from "../_helpers.mjs";

export default function item() {
  // The colors `act` read off the rendered canvas, for `assert` to compare.
  let samples;

  return {
    id: "color.head",

    async arrange(api) {
      await arrangeColorScene(api);
    },

    async act(api) {
      // settleMs 120 = the old poseColorScene's trailing api.wait(120). A real pause,
      // not simulation time: no amount of instant stepping paints a frame.
      samples = await actColorSamples(api, { settleMs: 120 });
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the head is a visible color, distinct from the board",
        colorDistance(samples.head, samples.background),
        VISIBLE_MIN,
      );
      check.expectGt(
        "the head is distinct from the body",
        colorDistance(samples.head, samples.body),
        HEAD_BODY_MIN,
      );
    },
  };
}
