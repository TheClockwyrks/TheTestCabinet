// Automated validation for the Color item `star`: the star (gravity well) is drawn in a
// distinct, visible color. The check samples the rendered pixels at the star core, the
// bodies, and an empty patch of field; the star's color must stand clearly apart from the
// background and from the ship, rocks, and saucer.

import { poseColorScene, sampleScene, colorDist } from "../_helpers.mjs";

const VISIBLE_MIN = 50;
const DISTINCT_MIN = 45;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.star");

  await poseColorScene(api);
  const c = await sampleScene(api);

  check.expectGt("the star is drawn in a visible color, distinct from the field background", colorDist(c.star, c.bg), VISIBLE_MIN);
  check.expectGt("the star's color is distinct from the ship's", colorDist(c.star, c.ship), DISTINCT_MIN);
  check.expectGt("the star's color is distinct from the rocks'", colorDist(c.star, c.rock), DISTINCT_MIN);
  check.expectGt("the star's color is distinct from the saucer's", colorDist(c.star, c.saucer), DISTINCT_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
