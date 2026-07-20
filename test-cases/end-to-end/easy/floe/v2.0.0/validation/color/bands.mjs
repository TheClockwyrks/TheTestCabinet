// Automated validation for the Color item `bands`.
//
// The water band, the ice band, and the median each render in a distinct color.
// The check samples the pixels the build actually RENDERS at a cleared water tile,
// a cleared ice tile, and a median tile, and confirms the three read distinct. The
// exact palette is the model's own; only the distinctness is scored. See
// validation/_helpers.mjs.

import { poseColorScene, sampleTile, colorDistance } from "../_helpers.mjs";

const DISTINCT = 30;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.bands");

  await poseColorScene(api);
  const water = await sampleTile(api, 10, 5); // cleared open water
  const ice = await sampleTile(api, 10, 15); // cleared road
  const median = await sampleTile(api, 5, 10); // median shelf

  check.expectGt("the water band reads distinct from the ice band", colorDistance(water, ice), DISTINCT);
  check.expectGt("the water band reads distinct from the median", colorDistance(water, median), DISTINCT);
  check.expectGt("the ice band reads distinct from the median", colorDistance(ice, median), DISTINCT);

  await api.screenshot("scene");
  return check.verdict();
}
