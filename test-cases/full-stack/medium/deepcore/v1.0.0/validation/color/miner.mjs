// Automated validation for color.miner.
//
// The miner renders in a color clearly distinct from the field behind it. We sample the miner's
// rendered center and a patch of the background sky, and confirm they stand apart.

import { newRun, minerScreen, sampleAt, colorDistance, VIEWPORT_Y } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.miner");

  await newRun(api); // miner idle on the surface, sky behind it
  await api.wait(150);
  const snap = await api.snapshot();
  const s = minerScreen(snap.miner, snap.camera);

  const minerColor = await sampleAt(api, s.x, s.y);
  const sky = await sampleAt(api, s.x, VIEWPORT_Y + 40); // a patch of sky above the ground line
  check.expectGt("the miner stands out from the background", colorDistance(minerColor, sky), 40);

  await api.screenshot("miner");
  return check.verdict();
}
