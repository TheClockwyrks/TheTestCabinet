// Automated validation for the Color item `bays`.
//
// An open bay renders in a distinct, inviting color, clearly different from the
// solid shore beside it. The check samples the pixels the build actually RENDERS at
// an open bay and at a solid-shore tile between bays, and confirms they read
// distinct. See validation/_helpers.mjs.

import {
  poseColorScene,
  sampleStage,
  sampleTile,
  tileCenter,
  colorDistance,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.bays");

  await poseColorScene(api); // bays all open on a fresh crossing
  // Bay 0 spans columns 3-4; sample toward its mouth. The shore between bays (col 8).
  const bayCenter = tileCenter(3, 1); // top-left tile of bay 0
  const bay = await sampleStage(api, bayCenter.x + 16, bayCenter.y + 6);
  const shore = await sampleTile(api, 8, 1);

  check.expectGt("an open bay reads distinct from the solid shore", colorDistance(bay, shore), 22);

  await api.screenshot("scene");
  return check.verdict();
}
