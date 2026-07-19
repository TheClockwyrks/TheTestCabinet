// Automated validation for the Color item `critter`.
//
// The critter renders in a distinct, visible color, clearly different from the
// strait tile beneath it. The check samples the pixels the build actually RENDERS
// at the critter (posed on the median) and at an empty median tile, and confirms
// they read distinct. See validation/_helpers.mjs.

import { poseColorScene, sampleTile, colorDistance } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.critter");

  await poseColorScene(api); // critter posed at (20, 10) on the median
  const critter = await sampleTile(api, 20, 10);
  const field = await sampleTile(api, 5, 10); // empty median

  check.expectGt("the critter reads distinct from the median beneath it", colorDistance(critter, field), 40);

  await api.screenshot("scene");
  return check.verdict();
}
