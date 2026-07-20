// Automated validation for the Color item `bear`.
//
// The bear renders in a distinct, visible color, clearly different from the strait
// tile beneath it. The check samples the pixels the build actually RENDERS at the
// bear (posed on the cleared road) and at an empty road tile, and confirms they
// read distinct. See validation/_helpers.mjs.

import { poseColorScene, sampleTile, colorDistance } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.bear");

  await poseColorScene(api); // bear posed at (24, 15) on the cleared road
  const bear = await sampleTile(api, 24, 15);
  const field = await sampleTile(api, 12, 15); // empty road

  check.expectGt("the bear reads distinct from the road beneath it", colorDistance(bear, field), 30);

  await api.screenshot("scene");
  return check.verdict();
}
