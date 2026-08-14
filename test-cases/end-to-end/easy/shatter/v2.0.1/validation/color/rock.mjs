// Automated validation for the Color item `rock`: rocks are drawn in a distinct, visible
// color. The check samples the rendered pixels at a rock, the other bodies, and an empty
// patch of field; the rock's color must stand clearly apart from the background and from
// the ship, star, and saucer, so a rock is not mistaken for another body.
//
// Posing the scene is instant (`arrange`); sampling belongs in `act`, where the real-time
// settle inside `actSampleScene` gives the build a frame to paint the posed scene before its
// pixels are read.

import { poseColorScene, actSampleScene, colorDist } from "../_helpers.mjs";

const VISIBLE_MIN = 50;
const DISTINCT_MIN = 45;

export default function item() {
  // The rendered colors sampled from the posed scene, read by `assert`.
  let c;

  return {
    id: "color.rock",

    async arrange(api) {
      await poseColorScene(api);
    },

    async act(api) {
      c = await actSampleScene(api);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "a rock is drawn in a visible color, distinct from the field background",
        colorDist(c.rock, c.bg),
        VISIBLE_MIN,
      );
      check.expectGt(
        "the rock's color is distinct from the ship's",
        colorDist(c.rock, c.ship),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the rock's color is distinct from the star's",
        colorDist(c.rock, c.star),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the rock's color is distinct from the saucer's",
        colorDist(c.rock, c.saucer),
        DISTINCT_MIN,
      );
    },
  };
}
