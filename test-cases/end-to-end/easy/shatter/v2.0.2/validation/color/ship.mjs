// Automated validation for the Color item `ship`: the ship is drawn in a distinct,
// visible color. The check samples the pixels the build actually RENDERS at the ship, the
// other bodies, and an empty patch of field (see _helpers.mjs — sampling reads the canvas,
// not a value the game reports). The ship's color must stand clearly apart from the field
// background and from the star, rocks, and saucer. The exact hue is the model's own.
//
// Posing the scene is instant, so it is `arrange`. Sampling belongs in `act` because a pixel
// read needs a FRAME to have been painted since the scene was posed — `actSampleScene` pauses
// in real time for that (`api.settle`, not `api.advance`, which would move the posed bodies
// out from under the sample points and paint nothing in the validate pass anyway).

import { poseColorScene, actSampleScene, colorDist } from "../_helpers.mjs";

const VISIBLE_MIN = 50; // clearly different from the field background
const DISTINCT_MIN = 45; // clearly different from another element

export default function item() {
  // The rendered colors sampled from the posed scene, read by `assert`.
  let c;

  return {
    id: "color.ship",

    async arrange(api) {
      await poseColorScene(api);
    },

    async act(api) {
      c = await actSampleScene(api);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the ship is drawn in a visible color, distinct from the field background",
        colorDist(c.ship, c.bg),
        VISIBLE_MIN,
      );
      check.expectGt(
        "the ship's color is distinct from the star's",
        colorDist(c.ship, c.star),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the ship's color is distinct from the rocks'",
        colorDist(c.ship, c.rock),
        DISTINCT_MIN,
      );
      check.expectGt(
        "the ship's color is distinct from the saucer's",
        colorDist(c.ship, c.saucer),
        DISTINCT_MIN,
      );
    },
  };
}
