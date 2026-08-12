// Automated validation (Warhead) for the Color item `torpedo`: the torpedo is drawn in a
// distinct, visible color (an acid-green, distinct from the white bullets). The check launches
// a real torpedo up the empty top of the field and samples the rendered pixels at the torpedo,
// the other bodies, and an empty patch of field; the torpedo's color must stand clearly apart
// from the background and from the ship, star, rocks, and saucer, so the heavy weapon reads at
// a glance.
//
// Posing the scene and readying the charge is instant (`arrange`); the launch and the sampling
// belong in `act`, where the real-time settle inside `actSampleTorpedoScene` gives the build a
// frame to paint before its pixels are read.

import {
  arrangeTorpedoColorScene,
  actSampleTorpedoScene,
  colorDist,
} from "../_helpers.mjs";

const VISIBLE_MIN = 50;
const DISTINCT_MIN = 45;

export default function item() {
  // The rendered colors sampled from the posed scene, read by `assert`.
  let c;

  return {
    id: "color.torpedo",

    async arrange(api) {
      await arrangeTorpedoColorScene(api);
    },

    async act(api) {
      c = await actSampleTorpedoScene(api);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectOk("a torpedo is in flight to sample", c.launched);
      const torp = c.torpedo ?? { r: 0, g: 0, b: 0 };
      check.expectGt(
        "the torpedo is drawn in a visible color, distinct from the field background",
        colorDist(torp, c.bg),
        VISIBLE_MIN,
      );
      check.expectGt(
        "the torpedo's color is distinct from the ship's",
        colorDist(torp, c.ship),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the torpedo's color is distinct from the star's",
        colorDist(torp, c.star),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the torpedo's color is distinct from the rocks'",
        colorDist(torp, c.rock),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the torpedo's color is distinct from the saucer's",
        colorDist(torp, c.saucer),
        DISTINCT_MIN,
      );
    },
  };
}
