// Automated validation for the Color item `saucer`: the saucer is drawn in a distinct,
// visible color. The check samples the rendered pixels at the saucer, the other bodies,
// and an empty patch of field; the saucer's color must stand clearly apart from the
// background and from the ship, star, and rocks, so the enemy reads at a glance.
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
    id: "color.saucer",

    async arrange(api) {
      await poseColorScene(api);
    },

    async act(api) {
      c = await actSampleScene(api);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the saucer is drawn in a visible color, distinct from the field background",
        colorDist(c.saucer, c.bg),
        VISIBLE_MIN,
      );
      check.expectGt(
        "the saucer's color is distinct from the ship's",
        colorDist(c.saucer, c.ship),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the saucer's color is distinct from the star's",
        colorDist(c.saucer, c.star),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the saucer's color is distinct from the rocks'",
        colorDist(c.saucer, c.rock),
        DISTINCT_MIN,
      );
    },
  };
}
