// Automated validation for the Color item `rock`: rocks are drawn in a distinct, visible
// color. The check samples the rendered pixels at a rock, the other bodies, and an empty
// patch of field; the rock's color must stand clearly apart from the background and from
// the ship, star, and saucer, so a rock is not mistaken for another body.

import { poseColorScene, sampleScene, colorDist } from "../_helpers.mjs";

const VISIBLE_MIN = 50;
const DISTINCT_MIN = 45;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.rock");

  await poseColorScene(api);
  const c = await sampleScene(api);

  check.expectGt("a rock is drawn in a visible color, distinct from the field background", colorDist(c.rock, c.bg), VISIBLE_MIN);
  check.expectGt("the rock's color is distinct from the ship's", colorDist(c.rock, c.ship), DISTINCT_MIN);
  check.expectGt("the rock's color is distinct from the star's", colorDist(c.rock, c.star), DISTINCT_MIN);
  check.expectGt("the rock's color is distinct from the saucer's", colorDist(c.rock, c.saucer), DISTINCT_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
