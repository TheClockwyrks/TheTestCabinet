// Automated validation for the Maze sub-item `obstacle-color`.
//
// The interior obstacles are drawn in a distinct, visible color. The check samples the
// pixels the build actually RENDERS at an obstacle cell (bar 1, at (8,4)), a snake body
// cell, and an empty board patch. The obstacle must stand clearly apart from the board
// background (so it is visible) and from the snake (so it is not mistaken for a body
// segment). The exact hue is the model's own; only the distinctness is scored.
//
// Posing the scene is instant (`arrange`); the repaint the samples need consumes real
// time, so the settle and the sampling are `act` — which is also all the clip has to
// show, since the scene is static and is exactly what is checked.

import {
  actColorSamples,
  arrangeColorScene,
  colorDistance,
  VISIBLE_MIN,
  DISTINCT_MIN,
} from "../_helpers.mjs";

export default function item() {
  // The colors `act` read off the rendered canvas, for `assert` to compare. This is the
  // only item that reads the `obstacle` sample: it exists in every scene, but in
  // Classic that cell is plain board.
  let samples;

  return {
    id: "maze.obstacle-color",

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
        "the obstacle is a visible color, distinct from the board",
        colorDistance(samples.obstacle, samples.background),
        VISIBLE_MIN,
      );
      check.expectGt(
        "the obstacle is distinct from the snake",
        colorDistance(samples.obstacle, samples.body),
        DISTINCT_MIN,
      );
    },
  };
}
