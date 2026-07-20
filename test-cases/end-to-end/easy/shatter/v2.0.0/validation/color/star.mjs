// Automated validation for the Color item `star`: the star (gravity well) is drawn in a
// distinct, visible color. The check samples the rendered pixels at the star core, the
// bodies, and an empty patch of field; the star's color must stand clearly apart from the
// background and from the ship, rocks, and saucer.
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
    id: "color.star",

    async arrange(api) {
      await poseColorScene(api);
    },

    async act(api) {
      c = await actSampleScene(api);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the star is drawn in a visible color, distinct from the field background",
        colorDist(c.star, c.bg),
        VISIBLE_MIN,
      );
      check.expectGt(
        "the star's color is distinct from the ship's",
        colorDist(c.star, c.ship),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the star's color is distinct from the rocks'",
        colorDist(c.star, c.rock),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the star's color is distinct from the saucer's",
        colorDist(c.star, c.saucer),
        DISTINCT_MIN,
      );
    },
  };
}
