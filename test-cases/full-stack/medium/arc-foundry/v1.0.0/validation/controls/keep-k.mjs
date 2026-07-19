// Automated validation for controls.keep-k: with a candidate selected in the build phase,
// pressing K harvests it — it becomes a firing component and the wave launches.

import { startBuild, placeCandidate, towerAt, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.keep-k");

  await startBuild(api);
  await placeCandidate(api, "capacitor", 1, 6, 7); // placing selects it
  await api.call("press", "KeyK");

  const s = await snap(api);
  check.expectEq("pressing K kept the candidate as a firing component", towerAt(s, 6, 7).kind, "component");
  check.expectEq("...and launched the wave", s.phase, "wave");

  await liveClip(api);
  return check.verdict();
}
