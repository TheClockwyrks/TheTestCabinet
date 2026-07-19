// Automated validation for the Color item `saucer`: the saucer is drawn in a distinct,
// visible color. The check samples the rendered pixels at the saucer, the other bodies,
// and an empty patch of field; the saucer's color must stand clearly apart from the
// background and from the ship, star, and rocks, so the enemy reads at a glance.

import { poseColorScene, sampleScene, colorDist } from "../_helpers.mjs";

const VISIBLE_MIN = 50;
const DISTINCT_MIN = 45;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.saucer");

  await poseColorScene(api);
  const c = await sampleScene(api);

  check.expectGt("the saucer is drawn in a visible color, distinct from the field background", colorDist(c.saucer, c.bg), VISIBLE_MIN);
  check.expectGt("the saucer's color is distinct from the ship's", colorDist(c.saucer, c.ship), DISTINCT_MIN);
  check.expectGt("the saucer's color is distinct from the star's", colorDist(c.saucer, c.star), DISTINCT_MIN);
  check.expectGt("the saucer's color is distinct from the rocks'", colorDist(c.saucer, c.rock), DISTINCT_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
