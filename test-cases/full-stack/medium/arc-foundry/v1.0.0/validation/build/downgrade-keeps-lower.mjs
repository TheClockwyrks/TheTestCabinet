// Automated validation for build.downgrade-keeps-lower: DOWNGRADE harvests the selected
// candidate as a firing component one quality tier lower and, being the harvest, launches
// the wave.

import { startBuild, placeCandidate, towerAt, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.downgrade-keeps-lower");

  await startBuild(api);
  const cand = await placeCandidate(api, "capacitor", 3, 6, 7); // a Charged (T3) candidate
  await api.call("downgrade", cand.id);

  const s = await snap(api);
  const at = towerAt(s, 6, 7);
  check.expectEq("downgrade harvested the candidate as a firing component", at.kind, "component");
  check.expectEq("...one quality tier lower (T3 -> T2)", at.quality, 2);
  check.expectEq("downgrade is the harvest, so it launched the wave", s.phase, "wave");

  await liveClip(api);
  return check.verdict();
}
